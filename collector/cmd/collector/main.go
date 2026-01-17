package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

type Config struct {
	BackendIngestURL string
	IngestToken      string

	TenantID string
	SiteID   string
	SourceID string

	ListenUDP string
	ListenTCP string

	CollectorName string

	HTTPTimeout time.Duration

	// Max syslog line size we accept (bytes). Anything bigger is truncated.
	MaxMessageBytes int

	// HTTP retry behavior (simple exponential backoff).
	MaxRetries int
}

type SyslogIngestRequest struct {
	TenantID       string `json:"tenant_id"`
	SiteID         string `json:"site_id,omitempty"`
	SourceID       string `json:"source_id,omitempty"`
	ReceivedAt     string `json:"received_at,omitempty"`
	SourceIP       string `json:"source_ip,omitempty"`
	RawMessage     string `json:"raw_message"`
	CollectorName  string `json:"collector_name,omitempty"`
	Transport      string `json:"transport,omitempty"` // udp|tcp
	RemoteAddr     string `json:"remote_addr,omitempty"`
	Listener       string `json:"listener,omitempty"` // the local listener addr
	Truncated      bool   `json:"truncated,omitempty"`
	OriginalLength int    `json:"original_length,omitempty"`
}

func main() {
	cfg, err := loadConfigFromEnv()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	logger := log.New(os.Stdout, "collector: ", log.LstdFlags|log.LUTC)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var shuttingDown atomic.Bool

	// Handle SIGINT/SIGTERM
	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		if shuttingDown.CompareAndSwap(false, true) {
			logger.Printf("shutdown signal received")
			cancel()
		}
	}()

	client := newHTTPClient(cfg.HTTPTimeout)

	// Run listeners
	errCh := make(chan error, 2)

	if strings.TrimSpace(cfg.ListenUDP) != "" {
		go func() { errCh <- runUDPListener(ctx, logger, cfg, client) }()
	} else {
		logger.Printf("udp listener disabled (LISTEN_UDP empty)")
	}

	if strings.TrimSpace(cfg.ListenTCP) != "" {
		go func() { errCh <- runTCPListener(ctx, logger, cfg, client) }()
	} else {
		logger.Printf("tcp listener disabled (LISTEN_TCP empty)")
	}

	// Block until ctx cancelled or an error occurs
	select {
	case <-ctx.Done():
		logger.Printf("context cancelled, exiting")
	case err := <-errCh:
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Printf("listener error: %v", err)
			cancel()
		}
	}

	// Give some time for in-flight requests to finish (best-effort)
	time.Sleep(250 * time.Millisecond)
	logger.Printf("bye")
}

func loadConfigFromEnv() (Config, error) {
	get := func(key string) string { return strings.TrimSpace(os.Getenv(key)) }

	cfg := Config{
		BackendIngestURL: get("BACKEND_INGEST_URL"),
		IngestToken:      get("INGEST_TOKEN"),

		TenantID: get("TENANT_ID"),
		SiteID:   get("SITE_ID"),
		SourceID: get("SOURCE_ID"),

		ListenUDP: get("LISTEN_UDP"),
		ListenTCP: get("LISTEN_TCP"),

		CollectorName: get("COLLECTOR_NAME"),

		HTTPTimeout:     10 * time.Second,
		MaxMessageBytes: 32 * 1024, // 32KB
		MaxRetries:      3,
	}

	if v := get("HTTP_TIMEOUT_SECONDS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return Config{}, errors.New("HTTP_TIMEOUT_SECONDS must be a positive integer")
		}
		cfg.HTTPTimeout = time.Duration(n) * time.Second
	}

	if v := get("MAX_MESSAGE_BYTES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1024 {
			return Config{}, errors.New("MAX_MESSAGE_BYTES must be an integer >= 1024")
		}
		cfg.MaxMessageBytes = n
	}

	if v := get("MAX_RETRIES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return Config{}, errors.New("MAX_RETRIES must be an integer >= 0")
		}
		cfg.MaxRetries = n
	}

	// Required fields
	if cfg.BackendIngestURL == "" {
		return Config{}, errors.New("BACKEND_INGEST_URL is required")
	}
	if cfg.IngestToken == "" {
		return Config{}, errors.New("INGEST_TOKEN is required")
	}
	if cfg.TenantID == "" {
		return Config{}, errors.New("TENANT_ID is required")
	}

	// Defaults
	if cfg.ListenUDP == "" && cfg.ListenTCP == "" {
		// Keep safe default for local dev
		cfg.ListenUDP = ":5514"
		cfg.ListenTCP = ":5514"
	}

	if cfg.CollectorName == "" {
		hostname, _ := os.Hostname()
		if hostname == "" {
			hostname = "collector"
		}
		cfg.CollectorName = hostname
	}

	return cfg, nil
}

func newHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			// Keep-alives help a lot when forwarding many small messages
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          100,
			MaxConnsPerHost:       100,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   5 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}
}

func runUDPListener(ctx context.Context, logger *log.Logger, cfg Config, client *http.Client) error {
	addr := cfg.ListenUDP
	udpAddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return err
	}

	conn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		return err
	}
	defer conn.Close()

	logger.Printf("udp listening on %s", conn.LocalAddr().String())

	// Make reads interruptible via deadline
	buf := make([]byte, 64*1024)

	for {
		select {
		case <-ctx.Done():
			return context.Canceled
		default:
		}

		_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, remote, err := conn.ReadFromUDP(buf)
		if err != nil {
			// timeout is expected to poll ctx
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				continue
			}
			// If ctx is done, treat as cancelled
			select {
			case <-ctx.Done():
				return context.Canceled
			default:
			}
			logger.Printf("udp read error: %v", err)
			continue
		}

		line := string(buf[:n])
		line = strings.TrimRight(line, "\r\n")

		// Forward in a goroutine to avoid blocking reads
		go func(msg string, r *net.UDPAddr, local string) {
			sendCtx, cancel := context.WithTimeout(ctx, cfg.HTTPTimeout)
			defer cancel()
			if err := forwardSyslog(sendCtx, cfg, client, logger, "udp", msg, r.IP.String(), r.String(), local); err != nil {
				logger.Printf("forward udp error: %v", err)
			}
		}(line, remote, conn.LocalAddr().String())
	}
}

func runTCPListener(ctx context.Context, logger *log.Logger, cfg Config, client *http.Client) error {
	addr := cfg.ListenTCP
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer ln.Close()

	logger.Printf("tcp listening on %s", ln.Addr().String())

	// Accept loop
	for {
		select {
		case <-ctx.Done():
			return context.Canceled
		default:
		}

		// Accept with deadline by using a short timeout on a TCPListener is not directly supported in net.Listener,
		// but we can set a deadline if it's a *net.TCPListener.
		if tl, ok := ln.(*net.TCPListener); ok {
			_ = tl.SetDeadline(time.Now().Add(1 * time.Second))
		}

		conn, err := ln.Accept()
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				continue
			}
			select {
			case <-ctx.Done():
				return context.Canceled
			default:
			}
			logger.Printf("tcp accept error: %v", err)
			continue
		}

		go handleTCPConn(ctx, logger, cfg, client, conn, ln.Addr().String())
	}
}

func handleTCPConn(ctx context.Context, logger *log.Logger, cfg Config, client *http.Client, conn net.Conn, listenerAddr string) {
	defer conn.Close()

	remote := conn.RemoteAddr().String()
	srcIP := remote
	if host, _, err := net.SplitHostPort(remote); err == nil {
		srcIP = host
	}

	// Syslog over TCP commonly uses newline-delimited messages (RFC6587 non-transparent framing).
	// We'll implement simple line-based reading.
	// We avoid bufio.Scanner default token limit by manual buffering.
	const readChunk = 4096
	tmp := make([]byte, readChunk)
	var buf bytes.Buffer

	// Keep connection responsive to shutdown
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, err := conn.Read(tmp)
		if n > 0 {
			buf.Write(tmp[:n])

			for {
				data := buf.Bytes()
				idx := bytes.IndexByte(data, '\n')
				if idx < 0 {
					break
				}
				line := string(data[:idx])
				// Consume line + '\n'
				buf.Next(idx + 1)

				line = strings.TrimRight(line, "\r")
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}

				sendCtx, cancel := context.WithTimeout(ctx, cfg.HTTPTimeout)
				if err := forwardSyslog(sendCtx, cfg, client, logger, "tcp", line, srcIP, remote, listenerAddr); err != nil {
					logger.Printf("forward tcp error: %v", err)
				}
				cancel()
			}
		}

		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				continue
			}
			if errors.Is(err, io.EOF) {
				return
			}
			logger.Printf("tcp read error (%s): %v", remote, err)
			return
		}
	}
}

func forwardSyslog(
	ctx context.Context,
	cfg Config,
	client *http.Client,
	logger *log.Logger,
	transport string,
	raw string,
	sourceIP string,
	remoteAddr string,
	listenerAddr string,
) error {
	originalLen := len(raw)
	truncated := false

	// Normalize message: keep as-is, but enforce max size
	if cfg.MaxMessageBytes > 0 && len(raw) > cfg.MaxMessageBytes {
		raw = raw[:cfg.MaxMessageBytes]
		truncated = true
	}

	body := SyslogIngestRequest{
		TenantID:       cfg.TenantID,
		SiteID:         cfg.SiteID,
		SourceID:       cfg.SourceID,
		ReceivedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		SourceIP:       sourceIP,
		RawMessage:     raw,
		CollectorName:  cfg.CollectorName,
		Transport:      transport,
		RemoteAddr:     remoteAddr,
		Listener:       listenerAddr,
		Truncated:      truncated,
		OriginalLength: originalLen,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.BackendIngestURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}

	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-ingest-token", cfg.IngestToken)
	req.Header.Set("user-agent", "centinela-collector/0.1.0")

	// Add idempotency-ish header (hash of payload); backend can optionally use it later for dedup.
	sum := sha256.Sum256(payload)
	req.Header.Set("x-payload-sha256", hex.EncodeToString(sum[:]))

	var lastErr error
	for attempt := 0; attempt <= cfg.MaxRetries; attempt++ {
		if attempt > 0 {
			backoff := computeBackoff(attempt)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}

		resp, err := client.Do(req.Clone(ctx))
		if err != nil {
			lastErr = err
			continue
		}

		// Drain response body
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}

		// 401/403 should not be retried (bad auth)
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			return errors.New("backend rejected auth (401/403)")
		}

		// Retry on 429 and 5xx
		if resp.StatusCode == 429 || (resp.StatusCode >= 500 && resp.StatusCode <= 599) {
			lastErr = errors.New("backend temporary error: " + strconv.Itoa(resp.StatusCode))
			continue
		}

		// Other 4xx: don't retry
		return errors.New("backend returned non-retryable status: " + strconv.Itoa(resp.StatusCode))
	}

	if lastErr != nil {
		return lastErr
	}
	logger.Printf("forward failed with unknown error")
	return errors.New("forward failed")
}

func computeBackoff(attempt int) time.Duration {
	// attempt starts at 1 for first retry
	// 1 -> 200ms, 2 -> 400ms, 3 -> 800ms, 4 -> 1600ms (cap 3s)
	base := 200 * time.Millisecond
	d := base * time.Duration(1<<(attempt-1))
	if d > 3*time.Second {
		d = 3 * time.Second
	}
	return d
}

-- Migration: 002_events
-- Description: Raw and normalized event tables

-- Raw events (original syslog messages, minimal processing)
CREATE TABLE IF NOT EXISTS raw_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    
    -- Metadata from collector
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_ip INET,
    transport VARCHAR(10), -- udp, tcp
    collector_name VARCHAR(255),
    
    -- Raw message
    raw_message TEXT NOT NULL,
    message_hash VARCHAR(64), -- SHA256 for dedup (optional)
    
    -- Processing status
    parsed BOOLEAN NOT NULL DEFAULT FALSE,
    parse_error TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for raw_events (optimized for recent queries and cleanup)
CREATE INDEX IF NOT EXISTS idx_raw_events_tenant_received 
    ON raw_events(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_events_received_at 
    ON raw_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_events_unparsed 
    ON raw_events(tenant_id, parsed) WHERE parsed = FALSE;

-- Normalized events (parsed and structured)
CREATE TABLE IF NOT EXISTS normalized_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_event_id UUID REFERENCES raw_events(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    
    -- Event timestamp (from log, or received_at if unavailable)
    ts TIMESTAMPTZ NOT NULL,
    
    -- Vendor info
    vendor VARCHAR(100) NOT NULL DEFAULT 'fortinet',
    product VARCHAR(100) NOT NULL DEFAULT 'fortigate',
    
    -- Normalized fields
    event_type VARCHAR(100), -- vpn_login, admin_login, config_change, utm_alert, firewall, etc.
    subtype VARCHAR(100),
    action VARCHAR(50), -- success, fail, deny, allow, block, detect
    severity VARCHAR(20), -- info, low, medium, high, critical
    
    -- Actors
    src_ip INET,
    src_port INTEGER,
    dst_ip INET,
    dst_port INTEGER,
    src_user VARCHAR(255),
    dst_user VARCHAR(255),
    
    -- Context
    interface VARCHAR(100),
    vdom VARCHAR(100),
    policy_id INTEGER,
    session_id BIGINT,
    
    -- Message and extra data
    message TEXT,
    raw_kv JSONB, -- parsed key-value pairs from FortiGate log
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for normalized_events
CREATE INDEX IF NOT EXISTS idx_norm_events_tenant_ts 
    ON normalized_events(tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_norm_events_tenant_type_ts 
    ON normalized_events(tenant_id, event_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_norm_events_tenant_src_ip 
    ON normalized_events(tenant_id, src_ip, ts DESC) WHERE src_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_norm_events_tenant_user 
    ON normalized_events(tenant_id, src_user, ts DESC) WHERE src_user IS NOT NULL;

-- Migration: 003_detections
-- Description: Detections, digests, and email delivery tracking

-- Detections (security alerts from rules engine)
CREATE TABLE IF NOT EXISTS detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    
    -- When detected
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Detection info
    detection_type VARCHAR(100) NOT NULL, -- vpn_bruteforce, admin_login_fail, config_change, etc.
    severity VARCHAR(20) NOT NULL DEFAULT 'medium', -- low, medium, high, critical
    
    -- Grouping for batching
    group_key VARCHAR(255), -- e.g., "user:john" or "ip:192.168.1.1"
    window_minutes INTEGER NOT NULL DEFAULT 15,
    
    -- Evidence
    event_count INTEGER NOT NULL DEFAULT 1,
    first_event_at TIMESTAMPTZ,
    last_event_at TIMESTAMPTZ,
    evidence JSONB, -- IPs, users, counts, sample events
    
    -- Related events (array of normalized_event IDs)
    related_event_ids UUID[],
    
    -- Status
    reported_digest_id UUID, -- set when included in a digest
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(255),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detections_tenant_detected 
    ON detections(tenant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_detections_tenant_type 
    ON detections(tenant_id, detection_type, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_detections_unreported 
    ON detections(tenant_id, detected_at DESC) WHERE reported_digest_id IS NULL;

-- Digests (batched reports ready for email)
CREATE TABLE IF NOT EXISTS digests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    
    -- Time window covered
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    
    -- Summary
    severity VARCHAR(20) NOT NULL, -- highest severity in the batch
    detection_count INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    
    -- Content
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT,
    locale VARCHAR(10) NOT NULL DEFAULT 'es',
    
    -- AI analysis (if enabled)
    ai_summary TEXT,
    ai_actions JSONB, -- recommended actions from AI Action Advisor
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_digests_tenant_created 
    ON digests(tenant_id, created_at DESC);

-- Email deliveries (tracking sent emails)
CREATE TABLE IF NOT EXISTS email_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    digest_id UUID NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
    
    -- Recipient
    to_email VARCHAR(255) NOT NULL,
    
    -- Provider info
    provider VARCHAR(100), -- smtp, sendgrid, mailgun, ses
    message_id VARCHAR(255), -- provider's message ID
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, sent, delivered, bounced, failed
    error TEXT,
    
    -- Timestamps
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_tenant 
    ON email_deliveries(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_digest 
    ON email_deliveries(digest_id);

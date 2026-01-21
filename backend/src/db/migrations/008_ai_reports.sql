-- Migration: 008_ai_reports
-- Description: AI Reports table for storing Writer agent generated reports

-- AI Reports (from AI Writer Agent)
CREATE TABLE IF NOT EXISTS ai_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Links to related entities
    detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,
    ai_analysis_id UUID REFERENCES ai_analyses(id) ON DELETE SET NULL,
    ai_recommendation_id UUID REFERENCES ai_recommendations(id) ON DELETE SET NULL,
    digest_id UUID REFERENCES digests(id) ON DELETE SET NULL,

    -- Report content
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    body_html TEXT, -- Optional HTML version
    locale VARCHAR(10) NOT NULL DEFAULT 'es',

    -- Metadata
    severity VARCHAR(20), -- Inherited from analysis: low, medium, high, critical
    threat_type VARCHAR(100), -- Inherited from analysis

    -- Model info
    model_used VARCHAR(100),
    tokens_used INTEGER,
    latency_ms INTEGER,

    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'generated', -- generated, sent, failed
    sent_at TIMESTAMPTZ,
    error_message TEXT,

    -- Raw response (for debugging)
    raw_response JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_reports_tenant
    ON ai_reports(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reports_detection
    ON ai_reports(detection_id);

CREATE INDEX IF NOT EXISTS idx_ai_reports_analysis
    ON ai_reports(ai_analysis_id);

CREATE INDEX IF NOT EXISTS idx_ai_reports_digest
    ON ai_reports(digest_id);

CREATE INDEX IF NOT EXISTS idx_ai_reports_status
    ON ai_reports(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reports_unsent
    ON ai_reports(tenant_id, created_at DESC)
    WHERE status = 'generated';

-- Add ai_report_id to digests for linking enhanced reports
ALTER TABLE digests
    ADD COLUMN IF NOT EXISTS ai_report_id UUID REFERENCES ai_reports(id) ON DELETE SET NULL;

-- Add index for the new column
CREATE INDEX IF NOT EXISTS idx_digests_ai_report
    ON digests(ai_report_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_ai_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ai_reports_updated_at ON ai_reports;
CREATE TRIGGER trigger_ai_reports_updated_at
    BEFORE UPDATE ON ai_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_reports_updated_at();

-- Migration: 009_ai_knowledge_cache
-- Description: AI Knowledge Cache for pattern learning and avoiding duplicate API calls

-- AI Knowledge Cache (learned patterns)
CREATE TABLE IF NOT EXISTS ai_knowledge_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Pattern signature (hash of detection characteristics)
    pattern_signature VARCHAR(64) NOT NULL, -- SHA-256 hash
    detection_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    
    -- Cached AI response
    threat_detected BOOLEAN NOT NULL,
    threat_type VARCHAR(100),
    confidence_score DECIMAL(3,2),
    context_summary TEXT,
    recommended_actions JSONB,
    report_subject TEXT,
    report_body TEXT,
    
    -- Usage stats
    hit_count INTEGER NOT NULL DEFAULT 1,
    last_hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- TTL and validity
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    is_valid BOOLEAN NOT NULL DEFAULT TRUE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(tenant_id, pattern_signature)
);

-- Index for fast cache lookup
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_cache_lookup
    ON ai_knowledge_cache(tenant_id, pattern_signature)
    WHERE is_valid = TRUE AND expires_at > NOW();

-- Index for cache management
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_cache_expiry
    ON ai_knowledge_cache(expires_at)
    WHERE is_valid = TRUE;

-- Index for analytics
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_cache_hits
    ON ai_knowledge_cache(tenant_id, hit_count DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_ai_knowledge_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ai_knowledge_cache_updated_at ON ai_knowledge_cache;
CREATE TRIGGER trigger_ai_knowledge_cache_updated_at
    BEFORE UPDATE ON ai_knowledge_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_knowledge_cache_updated_at();

-- Function to clean expired cache entries (call periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_ai_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM ai_knowledge_cache
    WHERE expires_at < NOW() OR is_valid = FALSE;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

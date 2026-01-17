-- Migration: 004_ai_tables
-- Description: AI analysis and recommendations tables

-- AI Analyses (from AI Log Analyzer)
CREATE TABLE IF NOT EXISTS ai_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Analysis window
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_batch_start TIMESTAMPTZ,
    event_batch_end TIMESTAMPTZ,
    event_count INTEGER NOT NULL DEFAULT 0,
    
    -- Results
    threat_detected BOOLEAN NOT NULL DEFAULT FALSE,
    threat_type VARCHAR(100),
    confidence_score DECIMAL(3,2), -- 0.00 to 1.00
    severity VARCHAR(20), -- low, medium, high, critical
    
    -- Context
    context_summary TEXT,
    correlated_event_ids UUID[],
    iocs JSONB, -- indicators of compromise: IPs, domains, hashes
    
    -- Model info
    model_used VARCHAR(100), -- gemini-2.0-flash, gpt-4o-mini, etc.
    tokens_used INTEGER,
    latency_ms INTEGER,
    
    -- Raw response (for debugging)
    raw_response JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_analyses_tenant 
    ON ai_analyses(tenant_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_threats 
    ON ai_analyses(tenant_id, analyzed_at DESC) WHERE threat_detected = TRUE;

-- AI Recommendations (from AI Action Advisor)
CREATE TABLE IF NOT EXISTS ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Source of recommendation
    detection_id UUID REFERENCES detections(id) ON DELETE SET NULL,
    ai_analysis_id UUID REFERENCES ai_analyses(id) ON DELETE SET NULL,
    
    -- Urgency and priority
    urgency VARCHAR(50) NOT NULL DEFAULT 'normal', -- immediate, urgent, normal, low
    
    -- Recommendations
    actions JSONB NOT NULL, -- array of action objects with priority, cli_commands, explanation, risk_level
    investigation_steps JSONB, -- array of strings
    
    -- Model info
    model_used VARCHAR(100),
    tokens_used INTEGER,
    latency_ms INTEGER,
    
    -- Raw response
    raw_response JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_tenant 
    ON ai_recommendations(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_detection 
    ON ai_recommendations(detection_id);
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_analysis 
    ON ai_recommendations(ai_analysis_id);

-- AI Configuration (per tenant settings)
CREATE TABLE IF NOT EXISTS ai_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    
    -- Feature flags
    analyzer_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    advisor_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Model configuration
    analyzer_model VARCHAR(100) NOT NULL DEFAULT 'gemini-2.0-flash-exp',
    advisor_model VARCHAR(100) NOT NULL DEFAULT 'gemini-2.0-flash-exp',
    temperature DECIMAL(2,1) NOT NULL DEFAULT 0.3,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    
    -- Cost control
    monthly_token_budget INTEGER NOT NULL DEFAULT 1000000,
    tokens_used_this_month INTEGER NOT NULL DEFAULT 0,
    budget_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()) + INTERVAL '1 month',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_config_tenant ON ai_config(tenant_id);

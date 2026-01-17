-- Migration: 007_fix_detections_tenant
-- Description: Fix detections table to use VARCHAR for tenant_id (MVP flexibility)

-- Drop FK constraints
ALTER TABLE detections DROP CONSTRAINT IF EXISTS detections_tenant_id_fkey;
ALTER TABLE detections DROP CONSTRAINT IF EXISTS detections_site_id_fkey;
ALTER TABLE detections DROP CONSTRAINT IF EXISTS detections_source_id_fkey;

-- Change column types
ALTER TABLE detections ALTER COLUMN tenant_id TYPE VARCHAR(255);
ALTER TABLE detections ALTER COLUMN site_id TYPE VARCHAR(255);
ALTER TABLE detections ALTER COLUMN source_id TYPE VARCHAR(255);

-- Also fix digests and email_deliveries
ALTER TABLE digests DROP CONSTRAINT IF EXISTS digests_tenant_id_fkey;
ALTER TABLE digests DROP CONSTRAINT IF EXISTS digests_site_id_fkey;
ALTER TABLE digests ALTER COLUMN tenant_id TYPE VARCHAR(255);
ALTER TABLE digests ALTER COLUMN site_id TYPE VARCHAR(255);

ALTER TABLE email_deliveries DROP CONSTRAINT IF EXISTS email_deliveries_tenant_id_fkey;
ALTER TABLE email_deliveries ALTER COLUMN tenant_id TYPE VARCHAR(255);

-- Fix AI tables too
ALTER TABLE ai_analyses DROP CONSTRAINT IF EXISTS ai_analyses_tenant_id_fkey;
ALTER TABLE ai_analyses ALTER COLUMN tenant_id TYPE VARCHAR(255);

ALTER TABLE ai_recommendations DROP CONSTRAINT IF EXISTS ai_recommendations_tenant_id_fkey;
ALTER TABLE ai_recommendations ALTER COLUMN tenant_id TYPE VARCHAR(255);

ALTER TABLE ai_config DROP CONSTRAINT IF EXISTS ai_config_tenant_id_fkey;
ALTER TABLE ai_config ALTER COLUMN tenant_id TYPE VARCHAR(255);

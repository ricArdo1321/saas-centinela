-- Migration: 006_fix_normalized_events
-- Description: Fix normalized_events to use VARCHAR for tenant_id, site_id, source_id (MVP flexibility)

-- Drop FK constraints
ALTER TABLE normalized_events DROP CONSTRAINT IF EXISTS normalized_events_tenant_id_fkey;
ALTER TABLE normalized_events DROP CONSTRAINT IF EXISTS normalized_events_site_id_fkey;
ALTER TABLE normalized_events DROP CONSTRAINT IF EXISTS normalized_events_source_id_fkey;

-- Change column types
ALTER TABLE normalized_events ALTER COLUMN tenant_id TYPE VARCHAR(255);
ALTER TABLE normalized_events ALTER COLUMN site_id TYPE VARCHAR(255);
ALTER TABLE normalized_events ALTER COLUMN source_id TYPE VARCHAR(255);

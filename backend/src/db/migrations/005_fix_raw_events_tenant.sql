-- Migration: 005_fix_raw_events_tenant
-- Description: Fix raw_events to use VARCHAR for tenant_id (MVP: collector sends arbitrary strings)
-- This allows ingesting events before tenant setup

-- Drop the FK constraint and change column type
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_tenant_id_fkey;
ALTER TABLE raw_events ALTER COLUMN tenant_id TYPE VARCHAR(255);

-- Also fix site_id and source_id to be VARCHAR for MVP flexibility
ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_site_id_fkey;
ALTER TABLE raw_events ALTER COLUMN site_id TYPE VARCHAR(255);

ALTER TABLE raw_events DROP CONSTRAINT IF EXISTS raw_events_source_id_fkey;
ALTER TABLE raw_events ALTER COLUMN source_id TYPE VARCHAR(255);

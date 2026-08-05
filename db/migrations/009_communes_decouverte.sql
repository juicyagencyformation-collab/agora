-- db/migrations/009_communes_decouverte.sql
-- Colonnes utilisées par worker/src/routes/decouverte.ts, documentées dans CLAUDE.md mais
-- jamais migrées (niveau_national confirmé absent en base au 2026-08-05 — 500 sur
-- /decouverte/evenements). partage_regional est inclus aussi par précaution, avec le même
-- ADD COLUMN IF NOT EXISTS idempotent : sans risque s'il existe déjà.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS niveau_national BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS partage_regional BOOLEAN NOT NULL DEFAULT false;

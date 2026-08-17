-- db/migrations/039_users_consentement_rgpd.sql
-- Filet de securite : consentement_rgpd_le est deja utilise par onboarding.ts et la migration
-- 035 (compte maire de demo) mais n'a jamais ete cree par une migration tracee, comme
-- communes.contact_email avant elle (voir migration 038). IF NOT EXISTS : no-op si la colonne
-- existe deja en base.
ALTER TABLE users ADD COLUMN IF NOT EXISTS consentement_rgpd_le TIMESTAMPTZ;

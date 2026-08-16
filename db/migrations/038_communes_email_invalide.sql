-- db/migrations/038_communes_email_invalide.sql
-- (1) Filet de securite : contact_email est deja selectionne par plusieurs routes existantes
--     (GET /administration/communes, POST /communes/:id/envoyer-presentation,
--     relancerEcheancesFacturation) mais n'a jamais ete cree par une migration tracee — a
--     l'IF NOT EXISTS pres, ne change rien si la colonne existe deja en base.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- (2) Signale un email de commune cliente rejete par Resend (jusqu'ici seuls les prospects
--     etaient traques, voir migration 030) — alimente le badge de sante du backoffice.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS email_invalide BOOLEAN NOT NULL DEFAULT false;

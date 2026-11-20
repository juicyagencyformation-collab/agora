-- db/migrations/109_accord_maire_par_lien.sql
-- 2026-11-20, validé par Léandre : faire accepter l'accord de sous-traitance RGPD (CGU article 10)
-- par le MAIRE lui-même, sans compte ni mot de passe. Depuis la fiche commune du backoffice
-- (onglet Dossier), Léandre envoie à l'adresse de la mairie un lien personnel : une page résume
-- les engagements, le nom du maire est pré-rempli, un bouton « J'accepte au nom de la commune, en
-- qualité de maire ». Jamais d'envoi automatique (relances auto arrêtées le 2026-11-05).
-- Le GET n'enregistre jamais rien (les messageries visitent les liens pour les analyser) : seul
-- le clic sur le bouton (POST) vaut accord. Lien à usage unique, valable 30 jours, stocké haché.
-- Logique : worker/src/routes/accord-maire.ts, worker/src/lib/cgu.ts.
-- Tests : worker/test/accord-maire.test.ts.

CREATE TABLE IF NOT EXISTS demandes_accord_maire (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  envoye_a TEXT NOT NULL,
  nom_maire TEXT,
  staff_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  utilise_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demandes_accord_maire_commune
  ON demandes_accord_maire (commune_id, created_at DESC);

-- Comment l'accord a été donné : dans l'application (compte connecté) ou par le lien envoyé à la
-- mairie. Affiché dans l'attestation.
ALTER TABLE acceptations_cgu ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'application'
  CHECK (canal IN ('application', 'lien_mairie'));

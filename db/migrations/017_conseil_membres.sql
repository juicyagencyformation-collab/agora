-- db/migrations/017_conseil_membres.sql
-- Trombinoscope du conseil municipal (maire, adjoints, conseillers) affiché dans l'onglet
-- Conseil. Photo et contact optionnels. Géré par les élus / le maire (comme le reste du conseil).
CREATE TABLE IF NOT EXISTS conseil_membres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  fonction TEXT,
  profession TEXT,
  contact TEXT,
  photo_url TEXT,
  photo_r2_key TEXT,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

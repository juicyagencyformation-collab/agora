-- db/migrations/032_connexions_journalieres.sql
-- Journal des connexions quotidiennes (1 ligne par habitant et par jour) pour les statistiques
-- de fréquentation affichées en Modération. Alimenté par gererConnexionQuotidienne (worker),
-- une seule fois par jour et par utilisateur (UNIQUE). Se remplit à partir de sa mise en service.
CREATE TABLE IF NOT EXISTS connexions_journalieres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  jour DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, jour)
);
CREATE INDEX IF NOT EXISTS idx_connexions_journalieres ON connexions_journalieres(commune_id, jour);

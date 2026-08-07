-- db/migrations/010_annuaire_medias.sql
-- Site web + logo pour les fiches annuaire (commerces, artisans, associations...), et une
-- table de documents joints (statuts d'association, plaquette PDF, photos...). La table
-- annuaire elle-même n'a jamais été suivie dans les migrations (créée directement en base) —
-- même situation que niveau_national en 009 : ALTER ... IF NOT EXISTS idempotent, sans risque.
ALTER TABLE annuaire ADD COLUMN IF NOT EXISTS site_web TEXT;
ALTER TABLE annuaire ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE annuaire ADD COLUMN IF NOT EXISTS logo_r2_key TEXT;

CREATE TABLE IF NOT EXISTS annuaire_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  fiche_id UUID NOT NULL REFERENCES annuaire(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL,
  nom_original TEXT,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

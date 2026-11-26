-- db/migrations/123_chartes_lues.sql
-- 2026-11-26, demandé par Léandre : preuve qu'un responsable (association, commerce, artisan) ou
-- un gestionnaire de la mairie a lu la charte de publication (frontend/charte-publication.html),
-- pour qu'on ne puisse pas dire « je ne l'avais pas vue » en cas de retrait contesté.
-- Une ligne par personne et par version : une nouvelle version de la charte (VERSION_CHARTE dans
-- worker/src/lib/moderation-publications.ts) est redemandée à chacun.
CREATE TABLE IF NOT EXISTS chartes_lues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commune_id, user_id, version)
);
CREATE INDEX IF NOT EXISTS idx_chartes_lues_commune ON chartes_lues (commune_id);

-- db/migrations/083_tentatives_connexion.sql
-- Échecs de connexion par mot de passe, pour bloquer un compte après trop d'essais (voir
-- worker/src/lib/securite.ts, MAX_ECHECS_CONNEXION). Complète le limiteur Cloudflare par IP, qui
-- est approximatif par conception (constaté le 2026-10-23 : premier blocage vers la 47e tentative).
-- commune_id NULL = connexion au backoffice (staff, hors commune). email toujours en minuscules.
-- Une ligne par échec ; purgée chaque nuit au-delà de 24 h (cron.ts, purgerTentativesConnexion).
CREATE TABLE IF NOT EXISTS tentatives_connexion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID REFERENCES communes(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tentatives_connexion_compte ON tentatives_connexion (email, commune_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tentatives_connexion_date ON tentatives_connexion (created_at);

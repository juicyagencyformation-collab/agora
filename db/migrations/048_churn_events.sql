-- db/migrations/048_churn_events.sql
-- Trace les transitions payant -> gratuit/résilié, à partir de maintenant (aucun historique
-- avant cette date n'est reconstituable : seul l'état actuel de communes.forfait/statut_client
-- était stocké). Alimentée depuis deux points précis dans administration.ts :
--   - POST /communes/:id/onglets/preset (preset='gratuit') si la commune payait avant
--   - PATCH /communes/:id/statut (statut_client='resiliee') si la commune payait
-- Voir GET /administration/chiffre-affaires pour la lecture agrégée (page "Chiffre d'affaires").
CREATE TABLE IF NOT EXISTS churn_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,              -- passage_gratuit | resiliation
  ancien_forfait TEXT,
  prix_annuel_perdu NUMERIC,       -- prix_annuel_ttc de la commune au moment du churn, si connu
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_churn_events_commune ON churn_events (commune_id);

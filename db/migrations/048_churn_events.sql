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
  prix_annuel_perdu NUMERIC,       -- communes.prix_annuel_ttc au moment du churn, TEL QUEL — sur
                                    -- un engagement 36 mois ce champ contient en réalité le total
                                    -- du contrat 3 ans (voir appliquerTarifSuggere), pas un prix
                                    -- annuel : ne jamais l'utiliser sans le diviser par 3 quand
                                    -- duree_engagement_mois=36 (voir GET .../chiffre-affaires).
  duree_engagement_mois INTEGER,   -- 12 ou 36, capturé au même instant que prix_annuel_perdu
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_churn_events_commune ON churn_events (commune_id);
-- Filet de sécurité si cette migration avait déjà été passée dans sa version précédente (sans
-- duree_engagement_mois) : rejouable sans erreur dans les deux cas.
ALTER TABLE churn_events ADD COLUMN IF NOT EXISTS duree_engagement_mois INTEGER;

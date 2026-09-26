-- db/migrations/066_dechets_exceptions.sql
-- Dates exceptionnelles du calendrier des déchets (collecte décalée pour cause de jour férié,
-- ramassage ponctuel type sapins de Noël...) : distinctes de dechets_config (règle récurrente
-- hebdomadaire) puisqu'elles ne se répètent jamais — une ligne = une date précise avec son
-- propre libellé, affichée au même titre qu'une collecte normale dans la carte d'accueil
-- (voir worker/src/routes/dechets.ts).
CREATE TABLE IF NOT EXISTS dechets_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  libelle TEXT NOT NULL,
  couleur TEXT NOT NULL DEFAULT '#C99A3E',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dechets_exceptions_commune_date ON dechets_exceptions(commune_id, date);

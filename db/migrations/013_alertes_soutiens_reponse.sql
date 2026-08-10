-- db/migrations/013_alertes_soutiens_reponse.sql
-- Soutiens des citoyens à un signalement (anti-farming : un seul soutien par personne et par
-- signalement, contrainte UNIQUE) + réponse officielle de la mairie sur le signalement.
CREATE TABLE IF NOT EXISTS alerte_soutiens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  alerte_id UUID NOT NULL REFERENCES alertes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alerte_id, user_id)
);

ALTER TABLE alertes ADD COLUMN IF NOT EXISTS reponse_officielle TEXT;
ALTER TABLE alertes ADD COLUMN IF NOT EXISTS reponse_par UUID REFERENCES users(id);
ALTER TABLE alertes ADD COLUMN IF NOT EXISTS reponse_le TIMESTAMPTZ;

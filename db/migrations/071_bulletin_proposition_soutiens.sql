-- db/migrations/071_bulletin_proposition_soutiens.sql
-- Soutiens des gestionnaires à une proposition de version de bulletin (même principe que
-- alerte_soutiens, voir 013_alertes_soutiens_reponse.sql) : purement indicatif, aide celui qui
-- adopte une version à voir laquelle fait consensus dans l'équipe. Anti-farming : un seul
-- soutien par personne et par proposition, contrainte UNIQUE.
CREATE TABLE IF NOT EXISTS bulletin_proposition_soutiens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  proposition_id UUID NOT NULL REFERENCES bulletin_propositions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(proposition_id, user_id)
);

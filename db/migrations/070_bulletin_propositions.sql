-- db/migrations/070_bulletin_propositions.sql
-- Rédaction d'un brouillon de bulletin à plusieurs mains : un gestionnaire propose sa propre
-- version (correction, reformulation...) sans jamais écraser le texte en place tant que
-- personne ne l'a explicitement adoptée (voir worker/src/routes/bulletin.ts, PATCH
-- /:id/propositions/:propId/adopter, qui remplace le contenu du brouillon puis efface les
-- autres propositions du même brouillon).
CREATE TABLE IF NOT EXISTS bulletin_propositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  bulletin_id UUID NOT NULL REFERENCES bulletin_municipal(id) ON DELETE CASCADE,
  auteur_id UUID NOT NULL REFERENCES users(id),
  titre TEXT NOT NULL,
  contenu_html TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bulletin_propositions_bulletin ON bulletin_propositions(bulletin_id);

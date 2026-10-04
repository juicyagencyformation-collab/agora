-- db/migrations/069_bulletin_rubriques.sql
-- Rédaction collaborative du bulletin municipal, réservée aux gestionnaires : un admin propose
-- une rubrique (titre + texte), un élu/maire/superadmin la valide avant qu'elle soit visible
-- des citoyens — même double regard que bulletin_municipal (brouillon → publication). Distinct
-- de bulletin_municipal (le numéro complet) : une rubrique est une contribution indépendante,
-- affichée à part dans l'onglet Bulletin une fois validée.
CREATE TABLE IF NOT EXISTS bulletin_rubriques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  auteur_id UUID NOT NULL REFERENCES users(id),
  nom_auteur TEXT, -- affiché à la place du compte gestionnaire si renseigné (ex. "Mairie", nom d'un élu)
  titre TEXT NOT NULL,
  contenu_html TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'attente', -- attente | validee
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bulletin_rubriques_commune_statut ON bulletin_rubriques(commune_id, statut);

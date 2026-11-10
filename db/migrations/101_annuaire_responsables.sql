-- db/migrations/101_annuaire_responsables.sql
-- 2026-11-10, validé par Léandre : espace des associations (lot 1).
-- Un habitant peut devenir responsable d'une fiche « association » de l'annuaire, sur demande
-- (bouton « Je fais partie du bureau ») validée par la mairie, ou désigné directement par la
-- mairie. Un responsable actif tient la fiche à jour (présentation, contacts, logo, documents) ;
-- la catégorie, la suppression de la fiche et la liste des responsables restent à la mairie.
-- Une même personne peut gérer plusieurs associations, une association peut avoir plusieurs
-- responsables (bureau). Lot 2 : publications d'actualités et d'événements au nom de la fiche.
CREATE TABLE IF NOT EXISTS annuaire_responsables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  fiche_id UUID NOT NULL REFERENCES annuaire(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statut TEXT NOT NULL DEFAULT 'demande' CHECK (statut IN ('demande', 'actif')),
  valide_par UUID REFERENCES users(id) ON DELETE SET NULL,
  valide_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fiche_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_annuaire_responsables_commune_statut
  ON annuaire_responsables (commune_id, statut);
CREATE INDEX IF NOT EXISTS idx_annuaire_responsables_user
  ON annuaire_responsables (user_id);

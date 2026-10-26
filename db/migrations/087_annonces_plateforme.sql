-- db/migrations/087_annonces_plateforme.sql
-- Annonces de Plateforme-Agora (nouveautés, maintenance, "Le saviez-vous ?"...) publiées depuis le
-- backoffice, affichées en bandeau sur l'accueil des communes ciblées. Table GLOBALE (pas de
-- commune_id) : une annonce vise toutes les communes, une liste de communes ou des régions.
CREATE TABLE IF NOT EXISTS annonces_plateforme (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('astuce', 'nouveaute', 'info', 'maintenance')),
  texte TEXT NOT NULL CHECK (char_length(texte) BETWEEN 1 AND 300),
  action TEXT NOT NULL DEFAULT 'aucune' CHECK (action IN ('aucune', 'partager', 'avis')),
  cible TEXT NOT NULL CHECK (cible IN ('toutes', 'communes', 'regions')),
  communes_ids UUID[] NOT NULL DEFAULT '{}',
  regions TEXT[] NOT NULL DEFAULT '{}',
  destinataires TEXT NOT NULL DEFAULT 'tous' CHECK (destinataires IN ('tous', 'gestionnaires')),
  debut_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin_le TIMESTAMPTZ NOT NULL,
  cree_par UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_annonces_plateforme_fin ON annonces_plateforme (fin_le);

-- Une annonce lue (fermée ou bouton d'action cliqué) ne réapparaît jamais pour cet habitant,
-- sur aucun appareil : pas de relance, pas de friction.
CREATE TABLE IF NOT EXISTS annonces_plateforme_lues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  annonce_id UUID NOT NULL REFERENCES annonces_plateforme(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (annonce_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_annonces_plateforme_lues_user ON annonces_plateforme_lues (user_id);

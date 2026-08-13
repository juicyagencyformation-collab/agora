-- db/migrations/026_statut_client_modele_email.sql
-- (1) Statut du cycle de vie d'une commune CLIENTE (distinct du statut d'un prospect) :
--     active | suspendue | resiliee. Les communes existantes sont 'active' par défaut.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS statut_client TEXT NOT NULL DEFAULT 'active';

-- (2) Modèle d'email de présentation, éditable une fois et réutilisé pour tous les envois
--     (prospects comme communes). Le corps supporte les variables {{commune}}, {{url}},
--     {{lien_fiche}}, substituées à l'envoi. cle='presentation' = l'unique modèle pour l'instant.
CREATE TABLE IF NOT EXISTS modeles_email (
  cle TEXT PRIMARY KEY,
  objet TEXT NOT NULL,
  corps_html TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

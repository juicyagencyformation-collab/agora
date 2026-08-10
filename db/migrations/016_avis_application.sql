-- db/migrations/016_avis_application.sql
-- Avis des citoyens sur l'application (note 1-5 + commentaire), depuis leur profil. Un seul
-- avis par personne (mis à jour ensuite). Destiné au futur back-office de Juicy Solutions.
CREATE TABLE IF NOT EXISTS avis_application (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note INTEGER NOT NULL CHECK (note BETWEEN 1 AND 5),
  commentaire TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

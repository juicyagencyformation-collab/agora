-- db/migrations/086_messages_mairie.sql
-- Bandeau "Message de la mairie" en haut de l'accueil (coupure d'eau, mairie fermée, nouveauté...).
-- Publié par un gestionnaire avec une date de fin ; disparaît seul passé cette date. La fermeture
-- par un habitant ("j'ai lu") est mémorisée sur son appareil uniquement (pas de table).
CREATE TABLE IF NOT EXISTS messages_mairie (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  auteur_id UUID REFERENCES users(id) ON DELETE SET NULL,
  texte TEXT NOT NULL CHECK (char_length(texte) BETWEEN 1 AND 280),
  fin_le TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_mairie_commune_fin ON messages_mairie (commune_id, fin_le);

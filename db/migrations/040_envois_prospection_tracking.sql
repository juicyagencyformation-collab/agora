-- db/migrations/040_envois_prospection_tracking.sql
-- Suivi structuré d'un envoi individuel d'email de présentation (prospect + variante), pour
-- mesurer un vrai entonnoir envoyé -> ouvert -> cliqué -> rejeté par variante A/B (décidé avec
-- Léandre le 2026-08-17). Corrélation avec les webhooks Resend via resend_email_id (identifiant
-- renvoyé par l'API à l'envoi) — précis, contrairement à un simple match par adresse email qui
-- serait ambigu en cas d'envois successifs au même contact.
CREATE TABLE IF NOT EXISTS envois_prospection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  resend_email_id TEXT UNIQUE,
  email TEXT NOT NULL,
  variante TEXT,
  envoye_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  ouvert_le TIMESTAMPTZ,
  clique_le TIMESTAMPTZ,
  lien_clique TEXT,
  rejete_le TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_envois_prospection_prospect ON envois_prospection (prospect_id);
CREATE INDEX IF NOT EXISTS idx_envois_prospection_resend_id ON envois_prospection (resend_email_id);

-- Filet de sécurité (même catégorie que les migrations 038/039) : ces trois colonnes sont déjà
-- utilisées par lib/gamification.ts et plusieurs routes (fréquentation, fiche utilisateurs)
-- sans avoir jamais été créées par une migration tracée. Nécessaire ici pour le signal
-- « connecté au moins une fois après activation » (bien plus fiable qu'un pixel d'ouverture).
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_actuel INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_record INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS derniere_connexion_streak DATE;

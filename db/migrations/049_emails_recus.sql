-- db/migrations/049_emails_recus.sql
-- Boîte de réception des réponses reçues des mairies suite à un email de prospection (via Resend
-- Receiving, événement email.received). Aucune interprétation IA : un tri par mots-clés classe
-- juste le message pour faciliter le traitement manuel depuis le backoffice (voir
-- worker/src/backoffice/emails-recus.ts). Même style que emails_rejetes (migration 030).
CREATE TABLE IF NOT EXISTS emails_recus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT,                            -- svix-id du webhook, pour la déduplication
  prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  commune_nom TEXT,                         -- dénormalisé : lisible même si le prospect est supprimé plus tard
  expediteur TEXT NOT NULL,
  sujet TEXT,
  texte TEXT,
  categorie TEXT NOT NULL DEFAULT 'autre',  -- fermeture | changement_email | autre
  traite_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_emails_recus_traite ON emails_recus (traite_le);
CREATE INDEX IF NOT EXISTS idx_emails_recus_created ON emails_recus (created_at DESC);

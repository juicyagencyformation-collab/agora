-- db/migrations/030_emails_rejetes.sql
-- Capture des emails rejetés (bounces / plaintes) remontés par les webhooks Resend. Sert à
-- suivre les adresses fautives et à ne plus les recontacter (réputation d'expéditeur).
CREATE TABLE IF NOT EXISTS emails_rejetes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT,                 -- identifiant du webhook (svix-id), pour la déduplication
  email TEXT NOT NULL,
  commune_nom TEXT,              -- meilleur effort : nom du prospect/commune correspondant
  sujet TEXT,
  type TEXT NOT NULL,           -- email.bounced | email.complained
  raison TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, email)        -- un webhook rejoué ne crée pas de doublon
);

CREATE INDEX IF NOT EXISTS idx_emails_rejetes_created ON emails_rejetes (created_at DESC);

-- Signalement de l'adresse fautive sur le prospect concerné (affiché en prospection).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email_invalide BOOLEAN NOT NULL DEFAULT false;

-- db/migrations/100_desinscriptions_email.sql
-- Adresses qui ont demandé à ne plus recevoir les emails « de suivi » (relances d'onboarding,
-- bilan mensuel, présentation/prospection...) — lien en bas de ces emails + bouton « Se
-- désabonner » des messageries (en-têtes List-Unsubscribe), voir worker/src/lib/desinscription.ts.
-- Ne concerne JAMAIS les emails de service (lien de connexion, mot de passe oublié, convention).
-- Une ligne par adresse (en minuscules), pas par commune : une même adresse de mairie peut servir
-- à plusieurs envois. commune_id renseigné quand on la connaît, pour l'affichage backoffice.
-- Jamais supprimée automatiquement : une réinscription ne se fait que sur demande expresse.
CREATE TABLE IF NOT EXISTS desinscriptions_email (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  commune_id UUID REFERENCES communes(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'lien' CHECK (source IN ('lien', 'messagerie')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

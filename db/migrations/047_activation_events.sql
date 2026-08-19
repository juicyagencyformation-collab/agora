-- db/migrations/047_activation_events.sql
-- Séquence d'onboarding/upsell des communes gratuites (voir worker/src/backoffice/onboarding-drip.ts) :
-- deux tables de suivi, même logique que les autres tables de garde-fou du projet (ex.
-- journal_activite, migration 043) — pas de RLS, pas de fonction ma_commune_id() : ce projet
-- n'utilise jamais Supabase RLS, toute la sécurité se fait dans le Worker via la clé
-- service-role et un filtre commune_id extrait du JWT (voir CLAUDE.md, règle non négociable).

-- Signaux qu'une commune s'approprie réellement l'outil (publication d'article, calendrier
-- déchets rempli, clic sur un module verrouillé...).
CREATE TABLE IF NOT EXISTS activation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activation_events_commune ON activation_events (commune_id);
CREATE INDEX IF NOT EXISTS idx_activation_events_type ON activation_events (commune_id, event_type);

-- Quel email de la séquence a été envoyé à quelle commune, et quand. La contrainte UNIQUE est
-- le vrai garde-fou anti-doublon (un envoi ne peut pas être journalisé deux fois pour le même
-- couple commune/email), en plus de la vérification faite avant tout envoi côté Worker.
CREATE TABLE IF NOT EXISTS sequence_emails_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commune_id, email_type)
);

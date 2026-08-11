-- db/migrations/021_memoire_village.sql
-- Module "La mémoire du village" : récits patrimoniaux des habitants (texte + photos + audio).
-- Contribution citoyenne, donc modération standard : signalement → masquage immédiat → revue mairie.
CREATE TABLE IF NOT EXISTS souvenirs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  titre TEXT NOT NULL,
  recit TEXT,
  theme TEXT NOT NULL DEFAULT 'autre',
  audio_url TEXT,
  audio_r2_key TEXT,
  statut TEXT NOT NULL DEFAULT 'visible', -- visible | masquee
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_souvenirs_commune ON souvenirs(commune_id, statut, created_at);

CREATE TABLE IF NOT EXISTS souvenir_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  souvenir_id UUID NOT NULL REFERENCES souvenirs(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  url TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS souvenir_signalements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  souvenir_id UUID NOT NULL REFERENCES souvenirs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(souvenir_id, user_id)
);

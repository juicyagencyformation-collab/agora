-- db/migrations/003_alerte_images.sql
CREATE TABLE alerte_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  alerte_id UUID NOT NULL REFERENCES alertes(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  url TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerte_images_alerte ON alerte_images(alerte_id);

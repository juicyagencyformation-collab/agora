-- db/migrations/055_alertes_meteo.sql
-- Vigilance météo (vent violent, orages, canicule...) affichée en bandeau sur l'accueil.
-- Distinct du module "alertes" (signalements citoyens) : ceci est une info officielle/mairie,
-- jamais soumise par un citoyen, pas de modération.
-- departement : nécessaire uniquement pour la synchro automatique (bulletin Météo-France est
-- par département) — saisie manuelle en Modération, aucune géolocalisation inverse.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS departement TEXT;

-- Une ligne = un risque actif pour une commune. UNIQUE(commune_id, type, origine) permet à la
-- synchro auto de faire un upsert sur son propre état sans jamais toucher aux alertes posées
-- à la main par la mairie (les deux peuvent coexister pour un même type, ex. la mairie qui
-- anticipe avant que le bulletin officiel ne soit mis à jour).
CREATE TABLE IF NOT EXISTS alertes_meteo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- vent_violent | pluie_inondation | orages | crues | neige_verglas | canicule | grand_froid | avalanches
  niveau TEXT NOT NULL, -- jaune | orange | rouge
  debut TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin TIMESTAMPTZ,
  origine TEXT NOT NULL DEFAULT 'manuel', -- manuel | auto
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(commune_id, type, origine)
);
CREATE INDEX IF NOT EXISTS idx_alertes_meteo_commune ON alertes_meteo(commune_id);

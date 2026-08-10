-- db/migrations/015_commune_infos_mairie.sql
-- Infos pratiques de la mairie affichées en bas de l'accueil (horaires d'ouverture,
-- permanences, téléphone, email), configurables en Modération par les élus et le maire.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS horaires_ouverture TEXT;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS permanences TEXT;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS telephone_mairie TEXT;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS email_mairie TEXT;

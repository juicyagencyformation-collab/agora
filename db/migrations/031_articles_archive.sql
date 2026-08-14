-- db/migrations/031_articles_archive.sql
-- Archivage des actualités : une actu archivée sort du fil principal mais reste consultable
-- par les citoyens dans une section "Archives" dédiée (réversible, distinct de la suppression).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS archive BOOLEAN NOT NULL DEFAULT false;

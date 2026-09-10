-- db/migrations/064_alertes_archive.sql
-- Archivage des signalements (même principe que articles.archive, migration antérieure) :
-- un signalement archivé sort de la liste/carte principale mais reste consultable dans la
-- section Archives. Réservé aux gestionnaires (voir worker/src/routes/alertes.ts).
ALTER TABLE alertes ADD COLUMN IF NOT EXISTS archive BOOLEAN NOT NULL DEFAULT false;

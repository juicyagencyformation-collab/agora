-- db/migrations/014_event_partage_autour.sql
-- Choix par événement d'apparaître (ou non) dans "Autour de moi" des communes voisines. N'a
-- d'effet que sur un événement officiel (créé par un gestionnaire). Défaut true : comportement
-- actuel préservé (tous les événements officiels restent partagés tant qu'on ne décoche pas).
ALTER TABLE events ADD COLUMN IF NOT EXISTS partage_autour BOOLEAN NOT NULL DEFAULT true;

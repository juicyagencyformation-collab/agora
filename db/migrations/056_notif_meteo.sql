-- db/migrations/056_notif_meteo.sql
-- Préférence de notification pour le résumé météo du matin (envoi quotidien, voir
-- worker/src/lib/notification-meteo.ts). Par défaut à false, contrairement aux autres
-- notif_* (articles, agenda...) qui sont événementielles et peu fréquentes : un envoi
-- quotidien garanti est plus intrusif, donc opt-in plutôt qu'opt-out.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_meteo BOOLEAN NOT NULL DEFAULT false;

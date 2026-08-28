-- db/migrations/058_notif_vigilance.sql
-- Préférence dédiée à la notification instantanée de vigilance météo (voir
-- notifierNouvelleVigilance dans lib/notification-meteo.ts), SÉPARÉE de notif_meteo (le
-- résumé quotidien, migration 056). Par défaut true, contrairement à notif_meteo : c'est
-- rare (seulement quand une vigilance orange/rouge se déclenche) et important pour la
-- sécurité — pas un envoi quotidien garanti. Sans cette séparation, quelqu'un voulant être
-- alerté d'une vigilance devrait s'abonner au bulletin météo de tous les matins pour l'obtenir.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_vigilance BOOLEAN NOT NULL DEFAULT true;

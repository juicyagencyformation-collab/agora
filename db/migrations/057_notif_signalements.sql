-- db/migrations/057_notif_signalements.sql
-- Préférence de notification pour les gestionnaires (admin/élu/maire/superadmin) : un nouveau
-- signalement citoyen. Par défaut true (contrairement à notif_meteo) : c'est une notification
-- de service pour les gestionnaires, pas un envoi de masse récurrent — l'équivalent d'un email
-- "vous avez une tâche à traiter", pas un digest. Sans effet pour un citoyen (jamais interrogée
-- pour ce rôle), mais la colonne existe pour tout le monde par simplicité (comme les autres notif_*).
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_signalements BOOLEAN NOT NULL DEFAULT true;

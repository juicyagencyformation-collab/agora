-- db/migrations/028_modele_email_logo.sql
-- Logo affiché en en-tête de l'email de présentation (uploadé depuis le backoffice, stocké
-- dans R2), inséré via la variable {{logo}}. NULL = pas de logo → repli sur le titre texte.
ALTER TABLE modeles_email ADD COLUMN IF NOT EXISTS logo_image_url TEXT;

-- db/migrations/027_modele_email_signature.sql
-- Photo de signature (uploadée depuis le backoffice, stockée dans R2) insérée dans l'email de
-- présentation via la variable {{signature_photo}}. NULL = pas de photo.
ALTER TABLE modeles_email ADD COLUMN IF NOT EXISTS signature_image_url TEXT;

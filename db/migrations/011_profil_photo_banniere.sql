-- db/migrations/011_profil_photo_banniere.sql
-- Photo de profil et bannière personnelles (onglet Profil), même logique que le logo de la
-- commune : URL publique + clé R2 conservée pour pouvoir supprimer l'ancien fichier au
-- remplacement.
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_profil_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_profil_r2_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banniere_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banniere_r2_key TEXT;

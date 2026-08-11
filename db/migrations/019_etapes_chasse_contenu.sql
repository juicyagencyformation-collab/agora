-- db/migrations/019_etapes_chasse_contenu.sql
-- Étapes de chasse au trésor enrichies : au scan du QR (donc sur place), une étape peut
-- déclencher un contenu — texte descriptif, photo, ou énigme (réponse à saisir pour valider).
-- type_contenu : 'aucun' (défaut, comportement historique) | 'texte' | 'photo' | 'enigme'.
ALTER TABLE etapes_chasse ADD COLUMN IF NOT EXISTS type_contenu TEXT NOT NULL DEFAULT 'aucun';
ALTER TABLE etapes_chasse ADD COLUMN IF NOT EXISTS contenu TEXT;          -- texte descriptif, ou question de l'énigme
ALTER TABLE etapes_chasse ADD COLUMN IF NOT EXISTS photo_url TEXT;        -- type 'photo'
ALTER TABLE etapes_chasse ADD COLUMN IF NOT EXISTS photo_r2_key TEXT;
ALTER TABLE etapes_chasse ADD COLUMN IF NOT EXISTS enigme_reponse TEXT;   -- réponse attendue (type 'enigme'), jamais renvoyée au client

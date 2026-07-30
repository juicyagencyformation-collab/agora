-- db/migrations/005_mur_cascade.sql
-- Le schéma initial (001) déclare déjà ON DELETE CASCADE sur comments/reactions.
-- Cette migration est un no-op de sécurité si tu avais un schéma antérieur sans cascade.
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_post_id_fkey;
ALTER TABLE comments ADD CONSTRAINT comments_post_id_fkey
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE reactions DROP CONSTRAINT IF EXISTS reactions_post_id_fkey;
ALTER TABLE reactions ADD CONSTRAINT reactions_post_id_fkey
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

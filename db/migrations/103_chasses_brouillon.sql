-- db/migrations/103_chasses_brouillon.sql
-- Brouillon de parcours (2026-11-13) : une chasse/balade est désormais créée en brouillon
-- (brouillon=true, actif=false) — invisible et injouable, puisque toutes les lectures et
-- validations côté joueur filtrent sur actif=true. La mairie la modifie librement (ajout,
-- retrait, réordre d'étapes), la teste sans rien enregistrer, puis la publie
-- (POST /chasses-tresor/:id/publier) : c'est à ce moment seulement que le push part.
-- Les parcours existants restent publiés (défaut false). Archivé = actif=false ET brouillon=false.
-- La table a déjà commune_id et created_at (001_schema_initial.sql).
ALTER TABLE chasses_tresor ADD COLUMN IF NOT EXISTS brouillon BOOLEAN NOT NULL DEFAULT false;

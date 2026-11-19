-- db/migrations/107_prospects_qualification.sql
-- Prospection par téléphone, lot 2 (2026-11-19) : ce que la mairie a dit pendant l'appel, en
-- menus déroulants (interlocuteur, outil actuel, ce qui lui pèse, qui décide, nombre de communes
-- gérées par la secrétaire), pour pouvoir compter plus tard ce qui fait réagir.
-- Format : {"interlocuteur": "secretaire", "outil_actuel": "facebook", ...} — clés et valeurs
-- validées par Zod dans worker/src/backoffice/prospection.ts (QUALIFICATION), clés vides absentes.
-- Table existante (commune_id, created_at déjà présents sur prospects) : une colonne de plus.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS qualification JSONB;

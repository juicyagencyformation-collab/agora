-- db/migrations/115_conventions_texte_personnalise.sql
-- 2026-11-20, demandé par Léandre : pouvoir réécrire tout le texte de la convention d'une commune
-- depuis le backoffice, avant signature. NULL = texte automatique (convention-document.ts).
-- Le HTML est nettoyé par le Worker (liste blanche de balises, aucun attribut) avant d'être stocké ;
-- le bloc des signatures et le DPA en annexe restent toujours générés. Figé à la signature comme le
-- reste (instantané document_signe_html, migration 097). Table déjà rattachée à commune_id (UNIQUE).
-- Logique : worker/src/backoffice/conventions.ts (PUT /:id/texte).
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS texte_personnalise TEXT;
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS texte_personnalise_le TIMESTAMPTZ;

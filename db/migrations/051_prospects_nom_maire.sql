-- db/migrations/051_prospects_nom_maire.sql
-- Nom du maire par prospect (2026-08-24, décidé avec Léandre) : l'enrichissement existant
-- (enrichirDepuisAnnuaire, table api-lannuaire-administration) donne le contact de la mairie mais
-- pas le nom de l'élu. Ajouté séparément via le Répertoire National des Élus (RNE, ministère de
-- l'Intérieur) — voir POST /prospection/synchroniser-maires dans worker/src/backoffice/prospection.ts.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS nom_maire TEXT;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS maire_civilite TEXT; -- 'Madame' ou 'Monsieur', déduit du sexe RNE

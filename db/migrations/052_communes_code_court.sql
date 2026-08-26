-- db/migrations/052_communes_code_court.sql
-- Code court par commune (2026-08-26, décidé avec Léandre) : le générateur QR maison du Worker
-- est plafonné à 42 caractères (voir CLAUDE.md, piège déjà documenté) et ne peut donc pas encoder
-- l'URL complète de l'app d'une commune (plateforme-agora.fr/<slug>/ dépasse la limite pour la
-- plupart des noms de commune). Ce code sert de lien court à la place : plateforme-agora.fr/q/<code>
-- (36 caractères avec le code, largement sous la limite), qui redirige vers la vraie URL — voir
-- worker/src/routes/liens_courts.ts et construireCarteVisite dans worker/src/backoffice/prospection.ts.
-- Généré paresseusement (au premier besoin d'un QR pour cette commune), pas de backfill en masse ici.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS code_court TEXT UNIQUE;

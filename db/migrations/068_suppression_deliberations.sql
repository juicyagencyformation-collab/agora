-- db/migrations/068_suppression_deliberations.sql
-- Retrait du module "délibérations" (vote citoyen pour/contre/abstention) : jugé non pertinent
-- pour l'app — une vraie délibération est l'acte officiel voté par le conseil municipal
-- lui-même, pas un vote ouvert aux habitants ; cette fonctionnalité prêtait à confusion et
-- faisait doublon avec le Thermomètre (sondages). Voir worker/src/index.ts et
-- frontend/js/conseil.js (code retiré dans le même commit que cette migration).
--
-- ⚠️ DESTRUCTIF : supprime définitivement toute délibération et tout vote déjà enregistrés.
-- À exécuter uniquement si cette perte est acceptée — vérifier le contenu des deux tables
-- avant si un doute existe (SELECT * FROM deliberations;).
DROP TABLE IF EXISTS votes_deliberation;
DROP TABLE IF EXISTS deliberations;

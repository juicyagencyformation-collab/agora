-- db/migrations/044_premiere_inscription_citoyen.sql
-- Marque le moment où le tout premier compte citoyen (hors compte Maire pré-créé) s'inscrit
-- dans une commune activée via la prospection — le signal d'engagement le plus fort après
-- l'email de présentation. Sert à la fois de garde d'idempotence (le message de bienvenue ne
-- part qu'une fois), de signal "🔥 s'est inscrit" dans la liste des prospects, et de base pour
-- la relance douce en cas d'inactivité ensuite (voir worker/src/backoffice/onboarding.ts).
ALTER TABLE communes ADD COLUMN IF NOT EXISTS premiere_inscription_citoyen_le TIMESTAMPTZ;

-- db/migrations/082_blocage_comptes.sql
-- Blocage d'un compte depuis le backoffice (onglet Utilisateurs) : empêche toute nouvelle
-- session (connexion, lien de connexion, rafraîchissement, bascule entre comptes liés) sans
-- anonymiser le compte. Réversible. bloque_le NULL = compte normal.
-- ⚠️ À exécuter dans Supabase AVANT le déploiement du Worker qui lit ces colonnes (sinon les
-- requêtes de connexion échoueraient sur une colonne inconnue).
ALTER TABLE users ADD COLUMN IF NOT EXISTS bloque_le TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bloque_motif TEXT;

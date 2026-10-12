-- db/migrations/080_cgu_soustraitance.sql
-- Acceptation des clauses de sous-traitance RGPD (art. 28) intégrées aux CGU, par les rôles
-- décideurs (admin/élu/maire/superadmin) uniquement — un citoyen n'engage pas juridiquement
-- la commune, voir conditions-utilisation.html. Décidé le 2026-10-12 avec Léandre : les
-- comptes admin-niveau déjà actifs ne doivent PAS être bloqués rétroactivement (impact sur
-- l'usage en cours) — seuls les comptes admin-niveau créés à partir de maintenant devront
-- accepter à leur première connexion. D'où le backfill ci-dessous : tout compte admin-niveau
-- déjà en base est marqué "déjà accepté" au moment de la migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cgu_sous_traitance_acceptee_le TIMESTAMPTZ;

UPDATE users SET cgu_sous_traitance_acceptee_le = now()
WHERE cgu_sous_traitance_acceptee_le IS NULL
  AND role IN ('admin', 'elu', 'maire', 'superadmin');

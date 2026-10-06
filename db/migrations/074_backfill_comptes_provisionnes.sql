-- db/migrations/074_backfill_comptes_provisionnes.sql
-- Backfill ponctuel : avant le 2026-10-06 (voir migration 073), le compte auto-créé à
-- l'activation d'une commune par la prospection portait role='maire' et le nom du maire
-- (réel via RNE, ou placeholder "Maire de X") — trompeur, puisque c'est en pratique quasi
-- toujours le secrétariat qui lit cet email en premier, jamais le maire lui-même. Cette
-- migration aligne les comptes déjà créés sous l'ancien comportement sur le nouveau.
--
-- Critère de sélection : un compte role='maire', sur une commune reliée à un prospect dont
-- le statut n'est PAS 'gagne'. 'gagne' n'est posé que par une vraie conversion manuelle
-- (worker/src/backoffice/onboarding.ts, POST /creer, staff uniquement) — c'est le seul cas où
-- role='maire' est légitime. Une commune sans prospect lié (Eaucourt, commune de démo,
-- Plateforme-Agora nationale) n'est jamais concernée : jointure sur prospects.commune_id, donc
-- pas de ligne à backfiller si aucun prospect ne pointe vers cette commune.
--
-- N'y touche jamais : email, password_hash — seuls role/prenom/nom/compte_provisionne changent.
UPDATE users u
SET role = 'admin', prenom = 'Administration', nom = c.nom, compte_provisionne = true
FROM communes c, prospects p
WHERE u.commune_id = c.id
  AND p.commune_id = c.id
  AND p.statut <> 'gagne'
  AND u.role = 'maire';

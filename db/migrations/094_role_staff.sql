-- db/migrations/094_role_staff.sql
-- Étape 4 du remaniement du backoffice (2026-11-04) : rôle des comptes staff. « admin » (Léandre)
-- garde tout ; « assistant » (assistant virtuel) ne peut techniquement pas toucher aux réglages
-- sensibles de la SOP §8 (tarifs, version gratuite, variante d'email active, informations de
-- l'entreprise, comptes staff, facturation libre, informations prestataire du DPA) — voir
-- exigerAdmin dans worker/src/middleware/backoffice.ts. Tous les comptes existants restent admin.
ALTER TABLE staff_backoffice ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'assistant'));

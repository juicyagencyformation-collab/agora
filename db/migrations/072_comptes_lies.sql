-- db/migrations/072_comptes_lies.sql
-- Comptes liés entre communes (secrétaire mutualisée administrant plusieurs petites communes,
-- chacune avec son propre compte) : tous les comptes partageant le même personne_id sont
-- considérés comme la même personne réelle. Le lien se crée uniquement depuis le backoffice
-- (staff), jamais en libre-service côté app citoyenne — voir worker/src/backoffice/
-- administration.ts (POST .../utilisateurs/:userId/lier) et worker/src/auth.ts (bascule
-- instantanée sans mot de passe entre comptes partageant ce personne_id).
ALTER TABLE users ADD COLUMN IF NOT EXISTS personne_id UUID;
CREATE INDEX IF NOT EXISTS idx_users_personne_id ON users(personne_id) WHERE personne_id IS NOT NULL;

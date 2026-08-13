-- db/migrations/023_backoffice_staff.sql
-- Backoffice interne Juicy Solutions : comptes du staff (Léandre & co), totalement séparés
-- des comptes citoyens (table users, rattachés à une commune_id). Aucun commune_id ici :
-- le staff est transverse à toutes les communes. Le JWT émis pour ces comptes porte un
-- scope 'backoffice' distinct et n'ouvre jamais l'accès aux routes tenant /:slug/*.
--
-- Le hash de mot de passe suit le même format PBKDF2 salé que les citoyens
-- (worker/src/lib/password.ts) — réutilise hasherMotDePasse/verifierMotDePasse tel quel.
-- Aucun endpoint d'inscription : les comptes staff se créent uniquement en base directement
-- (même principe de sécurité que le rôle superadmin, jamais attribuable via l'interface).
CREATE TABLE IF NOT EXISTS staff_backoffice (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nom TEXT NOT NULL,
  actif BOOLEAN NOT NULL DEFAULT true,
  derniere_connexion_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions du backoffice : refresh tokens dédiés, découplés des refresh_tokens citoyens
-- (qui portent une commune_id NOT NULL). Permet la révocation et le renouvellement de
-- session staff sans jamais toucher au périmètre citoyen.
CREATE TABLE IF NOT EXISTS staff_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_backoffice(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  revoked BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_refresh_token_hash ON staff_refresh_tokens (token_hash);

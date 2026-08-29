-- db/migrations/059_login_tokens.sql
-- Lien de connexion directe ("lien magique") à usage unique : généré depuis le backoffice
-- pour un maire qui n'arrive pas à se connecter, envoyé par email, valable 48h. Même
-- structure que password_reset_tokens (token en clair envoyé une seule fois, seul son hash
-- est stocké — voir worker/src/auth.ts).
CREATE TABLE IF NOT EXISTS login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  utilise BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_hash ON login_tokens(token_hash);

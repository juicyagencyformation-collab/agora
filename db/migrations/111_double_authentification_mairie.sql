-- db/migrations/111_double_authentification_mairie.sql
-- 2026-11-20, validé par Léandre (guide CNIL des collectivités 2026, p. 26 : l'authentification
-- multifacteur est « désormais essentielle ») : double authentification des comptes de la mairie
-- (admin, élu, maire, superadmin), SANS friction au quotidien. Un code à 6 chiffres est envoyé par
-- email seulement quand le mot de passe est saisi sur un appareil inconnu ; l'appareil est ensuite
-- reconnu 6 mois (cookie httpOnly propre à chaque compte, ce qui permet un ordinateur de mairie
-- partagé). Le lien de connexion reçu par email vaut second facteur et reconnaît l'appareil.
-- Les habitants ne sont pas concernés. Logique : worker/src/lib/double-authentification.ts.
-- Tests : worker/test/double-authentification.test.ts.

-- Connexion en attente du code : jeton remis au navigateur (stocké haché) + code, haché AVEC ce
-- jeton (une fuite de la base ne permet pas de retrouver le code par essais). 10 minutes,
-- 5 essais, 3 envois au plus.
CREATE TABLE IF NOT EXISTS codes_connexion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jeton_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  tentatives INTEGER NOT NULL DEFAULT 0,
  envois INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  utilise_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Appareils reconnus (6 mois) : seul le haché du jeton du cookie est stocké.
CREATE TABLE IF NOT EXISTS appareils_confiance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jeton_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appareils_confiance_user ON appareils_confiance (user_id);
CREATE INDEX IF NOT EXISTS idx_codes_connexion_expiration ON codes_connexion (expires_at);

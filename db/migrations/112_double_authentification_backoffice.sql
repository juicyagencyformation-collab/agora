-- db/migrations/112_double_authentification_backoffice.sql
-- 2026-11-20, choisi par Léandre (« une fois par jour ») : double authentification du backoffice
-- staff, le compte le plus sensible (toutes les communes). Un code reçu par email est demandé à la
-- connexion (après le mot de passe), puis au premier passage de chaque journée (sans retaper le
-- mot de passe) ; il vaut ensuite jusqu'au lendemain 5 h (heure de Paris).
-- Logique : worker/src/backoffice/auth.ts + lib/double-authentification.ts.
-- Tests : worker/test/double-authentification-backoffice.test.ts.

-- Jusqu'à quand la session portée par ce jeton de rafraîchissement a passé le code du jour.
-- NULL (sessions ouvertes avant cette migration) = code demandé au prochain rafraîchissement.
ALTER TABLE staff_refresh_tokens ADD COLUMN IF NOT EXISTS mfa_valide_jusqu TIMESTAMPTZ;

-- Codes en attente, mêmes règles que codes_connexion (migration 111) : 10 min, 5 essais,
-- 3 envois, usage unique, code haché avec le jeton remis au navigateur.
CREATE TABLE IF NOT EXISTS staff_codes_connexion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_backoffice(id) ON DELETE CASCADE,
  jeton_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  tentatives INTEGER NOT NULL DEFAULT 0,
  envois INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  utilise_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

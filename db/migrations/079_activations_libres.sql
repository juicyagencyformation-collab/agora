-- db/migrations/079_activations_libres.sql
-- Jetons de confirmation pour l'inscription gratuite en self-service (frontend/rejoindre.html,
-- voir worker/src/routes/decouverte.ts). Le visiteur renseigne son email → un jeton est posé ici
-- → l'email reçu ne fait que confirmer l'adresse → ce n'est qu'en cliquant le lien que la
-- personne arrive sur une vraie page de création de compte (prénom/nom/mot de passe choisis par
-- elle, jamais un compte "Administration" générique créé à l'avance). Même esprit que
-- login_tokens (token_hash, jamais le jeton en clair en base), mais distinct : login_tokens sert
-- à connecter un compte qui existe déjà, celui-ci sert à en créer un qui n'existe pas encore.
CREATE TABLE activations_libres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  utilise_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activations_libres_token_hash ON activations_libres(token_hash);

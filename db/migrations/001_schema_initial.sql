-- db/migrations/001_schema_initial.sql
-- Schéma de base complet (à exécuter en PREMIER dans Supabase SQL Editor)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE communes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  nom TEXT NOT NULL,
  population INTEGER,
  couleur_theme TEXT DEFAULT '#2c5f2d',
  couleur_accent TEXT DEFAULT '#4a8c4a',
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'citoyen', -- citoyen | admin | superadmin
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(commune_id, email)
);

CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  contenu TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  contenu TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

CREATE TABLE alertes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  titre TEXT NOT NULL,
  description TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  statut TEXT NOT NULL DEFAULT 'ouverte',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  titre TEXT NOT NULL,
  description TEXT,
  lieu TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  date_debut TIMESTAMPTZ NOT NULL,
  date_fin TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE event_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);

CREATE TABLE coups_de_main (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  titre TEXT NOT NULL,
  description TEXT NOT NULL,
  categorie TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chasses_tresor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  titre TEXT NOT NULL,
  description TEXT,
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE etapes_chasse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chasse_id UUID NOT NULL REFERENCES chasses_tresor(id) ON DELETE CASCADE,
  commune_id UUID NOT NULL REFERENCES communes(id),
  ordre INTEGER NOT NULL,
  titre TEXT NOT NULL,
  indice TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  qr_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE progressions_chasse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chasse_id UUID NOT NULL REFERENCES chasses_tresor(id) ON DELETE CASCADE,
  etape_id UUID NOT NULL REFERENCES etapes_chasse(id) ON DELETE CASCADE,
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  validee_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(etape_id, user_id)
);

CREATE TABLE sondages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  question TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'unique',
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE choix_sondage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sondage_id UUID NOT NULL REFERENCES sondages(id) ON DELETE CASCADE,
  commune_id UUID NOT NULL REFERENCES communes(id),
  label TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sondage_id UUID NOT NULL REFERENCES sondages(id) ON DELETE CASCADE,
  choix_id UUID NOT NULL REFERENCES choix_sondage(id) ON DELETE CASCADE,
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sondage_id, user_id)
);

CREATE TABLE deliberations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  titre TEXT NOT NULL,
  description TEXT,
  statut TEXT NOT NULL DEFAULT 'ouverte',
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE votes_deliberation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliberation_id UUID NOT NULL REFERENCES deliberations(id) ON DELETE CASCADE,
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  choix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(deliberation_id, user_id)
);

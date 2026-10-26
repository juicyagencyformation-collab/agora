-- db/migrations/088_conventions.sql
-- Convention « Commune fondatrice » : générée depuis le backoffice (backoffice/conventions.ts) à
-- partir des données de la commune et des informations réunies auprès d'elle. Ces informations
-- sont saisies par le staff OU par la secrétaire de mairie via un lien personnel (jeton) — la
-- liste "à réunir" se déduit des champs encore vides. Une convention par commune.
CREATE TABLE IF NOT EXISTS conventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL UNIQUE REFERENCES communes(id) ON DELETE CASCADE,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'envoyee', 'signee', 'annulee')),
  numero_fondatrice INTEGER CHECK (numero_fondatrice BETWEEN 1 AND 10),
  signataire_nom TEXT,
  signataire_qualite TEXT,
  deliberation_reference TEXT,
  deliberation_date DATE,
  option_reconduction TEXT CHECK (option_reconduction IN ('tacite', 'annuelle')),
  siret_commune TEXT,
  code_service_chorus TEXT,
  facturation_nom TEXT,
  facturation_email TEXT,
  date_debut_souhaitee DATE,
  citation_autorisee BOOLEAN,
  jeton_formulaire TEXT NOT NULL UNIQUE,
  formulaire_rempli_le TIMESTAMPTZ,
  envoyee_le TIMESTAMPTZ,
  signee_le DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Le statut est réservé aux 10 premières communes : jamais deux fois le même numéro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conventions_numero_fondatrice
  ON conventions (numero_fondatrice) WHERE numero_fondatrice IS NOT NULL AND statut <> 'annulee';

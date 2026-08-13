-- db/migrations/024_prospects.sql
-- Phase 2 du backoffice : prospection commerciale des communes françaises.
--
-- Note sur commune_id : contrairement au contenu tenant (règle CLAUDE.md), un prospect n'est
-- PAS rattaché à une commune cliente — c'est une commune candidate, transverse au staff. La
-- colonne commune_id ici est nullable et sert de pont vers la Phase 3 : quand un prospect
-- devient client (statut 'gagne' → onboarding), on y relie la ligne communes créée.
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_insee TEXT NOT NULL UNIQUE,         -- clé de dédup naturelle (source open data)
  nom TEXT NOT NULL,
  code_postal TEXT,
  departement TEXT NOT NULL,               -- code département (ex '80', '2A')
  population INTEGER,
  statut TEXT NOT NULL DEFAULT 'a_contacter',  -- a_contacter | contacte | relance | rdv | gagne | perdu
  contact_email TEXT,
  contact_telephone TEXT,
  site_web TEXT,
  adresse TEXT,
  notes TEXT,
  prochaine_relance_le DATE,
  enrichi_le TIMESTAMPTZ,                   -- date du dernier enrichissement via l'annuaire
  commune_id UUID REFERENCES communes(id) ON DELETE SET NULL,  -- pont Phase 3 (client)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospects_departement ON prospects (departement);
CREATE INDEX IF NOT EXISTS idx_prospects_statut ON prospects (statut);

-- Timeline des relances/échanges : c'est l'historique commercial du prospect. type 'statut'
-- est journalisé automatiquement à chaque changement de statut (voir prospection.ts).
CREATE TABLE IF NOT EXISTS prospect_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff_backoffice(id) ON DELETE SET NULL,
  type TEXT NOT NULL,                       -- note | appel | email | courrier | rdv | statut
  contenu TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospect_interactions_prospect ON prospect_interactions (prospect_id, created_at DESC);

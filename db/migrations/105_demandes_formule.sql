-- db/migrations/105_demandes_formule.sql
-- 2026-11-18, validé par Léandre (maquette https://claude.ai/artifact/38TEWSi4pkYLd9RWE69i5E) :
-- volet « Votre formule » de Ma commune. Le maire ou un élu demande en un bouton à passer à
-- Autonomie ou Accompagné (ou à être conseillé). Rien ne s'active tout seul : un email part à
-- l'équipe, la demande apparaît dans le backoffice (page Aujourd'hui), on rappelle, la convention
-- est signée, puis la formule est activée à la main.
-- Une seule demande en attente par commune (index unique partiel) ; une demande en attente
-- depuis plus de 30 jours n'est plus considérée comme en cours (voir routes/commune.ts), et elle
-- passe à « traitee » dès que la formule ou le palier de la commune change dans le backoffice.
-- Logique : worker/src/routes/commune.ts. Tests : worker/test/demande-formule.test.ts.
CREATE TABLE IF NOT EXISTS demandes_formule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  formule_souhaitee TEXT NOT NULL CHECK (formule_souhaitee IN ('autonomie', 'accompagne', 'conseil')),
  telephone TEXT,
  message TEXT,
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'traitee')),
  traitee_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_demandes_formule_une_en_attente
  ON demandes_formule (commune_id) WHERE statut = 'en_attente';
CREATE INDEX IF NOT EXISTS idx_demandes_formule_statut
  ON demandes_formule (statut, created_at);

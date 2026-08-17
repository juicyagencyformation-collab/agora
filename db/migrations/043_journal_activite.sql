-- db/migrations/043_journal_activite.sql
-- Journal d'activite MINIMAL : qui a fait quoi, uniquement sur les actions a fort impact
-- (changement global/retroactif du palier gratuit, grille tarifaire, statut d'une commune,
-- anonymisation RGPD, comptes staff, facture marquee payee...). Pas un audit log exhaustif de
-- toutes les mutations - volontairement cible sur ce qui merite d'etre retrace.
CREATE TABLE IF NOT EXISTS journal_activite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff_backoffice(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_activite_created ON journal_activite (created_at DESC);

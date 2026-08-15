-- db/migrations/033_exports_rgpd.sql
-- Journal des demandes d'export de données personnelles (droit à la portabilité RGPD,
-- GET /auth/mes-donnees). Sert uniquement à des statistiques de suivi côté backoffice
-- (combien de citoyens exportent leurs données, à quelle fréquence). Les suppressions de
-- compte, elles, n'ont pas besoin de nouvelle table : users.compte_supprime_le les journalise
-- déjà (rempli par DELETE /auth/moi, anonymisation RGPD).
CREATE TABLE IF NOT EXISTS exports_rgpd_donnees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exports_rgpd_commune ON exports_rgpd_donnees (commune_id, created_at DESC);

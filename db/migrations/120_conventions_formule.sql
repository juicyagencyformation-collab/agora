-- db/migrations/120_conventions_formule.sql
-- 2026-11-23, demandé par Léandre : la convention fondatrice précise sa formule.
-- - gratuit     : version gratuite + onglets payants offerts (conventions.onglets_offerts, migration
--                 119) pour 12 mois, reconduits TACITEMENT 3 fois au plus (4 ans) ; chacun peut refuser
--                 la reconduction par mail 2 mois avant. Aucune facture. (Fay-les-Étangs, Tourly.)
-- - autonomie   : abonnement au tarif fondateur (texte d'avant ; NULL = autonomie).
-- - accompagne  : idem avec les services Accompagné.
-- Reconduction des onglets offerts : faite par le cron de 4 h (cron.ts, fermerOngletsOfferts) le
-- lendemain de la date de fin, tant que offre_reconductions < 3 et que offre_non_reconduite est faux
-- (« Ne pas reconduire » dans le backoffice, après refus de la mairie ou du Prestataire).

ALTER TABLE conventions ADD COLUMN IF NOT EXISTS formule TEXT
  CHECK (formule IS NULL OR formule IN ('gratuit', 'autonomie', 'accompagne'));
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS offre_reconductions INTEGER NOT NULL DEFAULT 0
  CHECK (offre_reconductions BETWEEN 0 AND 3);
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS offre_non_reconduite BOOLEAN NOT NULL DEFAULT false;

-- Onglets offerts déjà cochés depuis la migration 119 : c'était l'offre gratuite à la carte.
UPDATE conventions SET formule = 'gratuit'
  WHERE formule IS NULL AND onglets_offerts IS NOT NULL AND cardinality(onglets_offerts) > 0;

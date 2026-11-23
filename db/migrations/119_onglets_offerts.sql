-- db/migrations/119_onglets_offerts.sql
-- 2026-11-23, demandé par Léandre : convention fondatrice « à la carte ». Au lieu de l'accès complet
-- offert 12 mois, la commune reste en version gratuite et reçoit en plus QUELQUES onglets payants
-- offerts pendant 12 mois (ex. Fay-les-Étangs et Tourly : Coups de main + Mur des voisins).
--
-- conventions.onglets_offerts : onglets offerts inscrits dans la convention (NULL = accès complet
--   offert, comportement d'avant). N'a de sens qu'avec premiere_annee_offerte = true.
-- onglets_config.offert_jusqu_au : dernier jour inclus de l'offre pour CET onglet de CETTE commune.
--   Posée par « Mettre en service l'offre » (backoffice/conventions.ts). Le cron de 4 h ferme
--   l'onglet le lendemain (cron.ts, fermerOngletsOfferts) ; un rappel apparaît 30 jours avant dans
--   Aujourd'hui → Anomalies. Remise à NULL par tout préréglage d'onglets et par l'activation d'un
--   abonnement (appliquerOngletsSurCommune) : un onglet payé ne se ferme jamais tout seul.
-- Logique : worker/src/backoffice/conventions.ts, convention-document.ts, cron.ts, suivi-communes.ts.

ALTER TABLE conventions ADD COLUMN IF NOT EXISTS onglets_offerts TEXT[];

ALTER TABLE onglets_config ADD COLUMN IF NOT EXISTS offert_jusqu_au DATE;
CREATE INDEX IF NOT EXISTS idx_onglets_config_offert_jusqu_au
  ON onglets_config (offert_jusqu_au) WHERE offert_jusqu_au IS NOT NULL;

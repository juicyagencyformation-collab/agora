-- db/migrations/121_dpa_texte_personnalise.sql
-- 2026-11-23, demandé par Léandre : le contrat DPA (accord de sous-traitance RGPD) se modifie à la
-- main pour une commune, comme la convention (migration 115). Deux parties, séparées par le bloc des
-- signatures (toujours généré : la signature électronique s'y place) :
-- - texte_contrat  : de l'en-tête à l'article 20 ;
-- - texte_annexes  : annexes 1 à 3.
-- NULL = texte automatique pour cette partie. HTML nettoyé par le Worker (liste blanche de balises,
-- contrat-dpa.ts). Refusé une fois la convention de la commune signée par le Prestataire.
-- Logique : worker/src/backoffice/facturation.ts (PUT /contrat-dpa/:communeId/texte), contrat-dpa.ts.

ALTER TABLE dpa_communes ADD COLUMN IF NOT EXISTS texte_contrat TEXT;
ALTER TABLE dpa_communes ADD COLUMN IF NOT EXISTS texte_annexes TEXT;
ALTER TABLE dpa_communes ADD COLUMN IF NOT EXISTS texte_personnalise_le TIMESTAMPTZ;

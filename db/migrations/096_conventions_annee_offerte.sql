-- db/migrations/096_conventions_annee_offerte.sql
-- 2026-11-04 (décision Léandre) : l'accord exceptionnel de Fay-les-Étangs et Tourly passe de
-- « 1 € la première année » à « première année offerte », suivie d'un prix fondateur EXACT inscrit
-- dans chaque convention (ex. 188,50 €/an = offre Autonomie − 35 %). Chaque convention a son propre
-- prix (Fay et Tourly sont deux conventions distinctes). Et un champ libre « Conditions
-- particulières » ajouté tel quel à la convention, pour tout arrangement propre à une commune.

-- Renommage (sans perte : les cases déjà cochées restent cochées).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conventions' AND column_name = 'un_euro_premiere_annee') THEN
    ALTER TABLE conventions RENAME COLUMN un_euro_premiere_annee TO premiere_annee_offerte;
  END IF;
END $$;
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS premiere_annee_offerte BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conventions ADD COLUMN IF NOT EXISTS prix_annuel_fondateur NUMERIC(10, 2)
  CHECK (prix_annuel_fondateur IS NULL OR prix_annuel_fondateur >= 0);
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS conditions_particulieres TEXT;

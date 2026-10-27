-- db/migrations/090_conventions_un_euro.sql
-- « 1 € la première année » : accord exceptionnel (Fay-les-Étangs, Tourly), coché sur la fiche
-- convention du backoffice. Décoché (défaut) : abonnement à -35 % dès la mise en service.
ALTER TABLE conventions
  ADD COLUMN IF NOT EXISTS un_euro_premiere_annee boolean NOT NULL DEFAULT false;

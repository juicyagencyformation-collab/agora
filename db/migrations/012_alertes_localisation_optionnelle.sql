-- db/migrations/012_alertes_localisation_optionnelle.sql
-- La localisation d'un signalement devient optionnelle : lat/lng peuvent être NULL (le
-- signalement reste dans la liste, il est juste absent de la carte). Sans ça, l'insertion
-- d'une alerte sans coordonnées échoue (contrainte NOT NULL d'origine).
ALTER TABLE alertes ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE alertes ALTER COLUMN lng DROP NOT NULL;

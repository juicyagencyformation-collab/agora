-- db/migrations/029_prospects_coordonnees.sql
-- Coordonnées du centre de la mairie, remplies opportunément lors de l'enrichissement depuis
-- l'annuaire (qui renvoie déjà lat/lng dans l'adresse) — aucune requête supplémentaire. La carte
-- de prospection n'affiche que les prospects géolocalisés : elle se remplit au fil du travail.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

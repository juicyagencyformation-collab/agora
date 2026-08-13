-- db/migrations/022_memoire_ancetres.sql
-- Frise chronologique des ancêtres (thème "Familles & ancêtres" de la Mémoire du village) :
-- un souvenir peut décrire une personne précise, avec son portrait (1re photo du souvenir),
-- affichée sur une frise triée par date de naissance.
ALTER TABLE souvenirs ADD COLUMN IF NOT EXISTS personne_nom TEXT;
ALTER TABLE souvenirs ADD COLUMN IF NOT EXISTS personne_date_naissance DATE;
ALTER TABLE souvenirs ADD COLUMN IF NOT EXISTS personne_date_deces DATE; -- vide = vivant(e) ou non précisé

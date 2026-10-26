-- db/migrations/085_affichage_nom_anonyme.sql
-- Simplification de 084 : un seul choix anonyme ("Anonyme") au lieu de "Un habitant" /
-- "Une habitante" (pas de genre à indiquer, un choix de moins).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_affichage_nom_check;
UPDATE users SET affichage_nom = 'anonyme' WHERE affichage_nom IN ('habitant', 'habitante');
ALTER TABLE users ADD CONSTRAINT users_affichage_nom_check CHECK (affichage_nom IN ('initiale', 'anonyme'));

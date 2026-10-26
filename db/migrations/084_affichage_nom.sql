-- db/migrations/084_affichage_nom.sql
-- Choix de chaque habitant pour l'affichage de son nom sur ses publications (photos, Mur, entraide,
-- agenda, alertes, mémoire, lois, classements). 'initiale' (défaut) = "Léandre S." ;
-- 'habitant' / 'habitante' = anonyme ("Un habitant" / "Une habitante").
-- Le vrai nom reste visible de l'intéressé lui-même et de la mairie dans les outils de gestion
-- (modération, contacts d'événement, validation de présence, backoffice).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS affichage_nom TEXT NOT NULL DEFAULT 'initiale'
  CHECK (affichage_nom IN ('initiale', 'habitant', 'habitante'));

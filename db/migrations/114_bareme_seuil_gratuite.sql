-- db/migrations/114_bareme_seuil_gratuite.sql
-- 2026-11-20, décidé avec Léandre (face à PanneauPocket, gratuit à vie sous 100 habitants) :
-- en dessous de ce nombre d'habitants, l'offre Autonomie est gratuite à vie (Accompagné = le seul
-- supplément). Réglable dans le tiroir Tarification du backoffice ; 0 = désactivé.
-- Même table clé/valeur que le reste du barème (migration 050) : pas de commune_id (paramètre de
-- plateforme), clé déjà UNIQUE. Logique : worker/src/backoffice/tarification.ts (estGratuitAVie).
INSERT INTO parametres_facturation (cle, valeur) VALUES
  ('bareme_seuil_gratuite', '100')
ON CONFLICT (cle) DO NOTHING;

-- db/migrations/050_bareme_habitant.sql
-- Nouveau modèle tarifaire (2026-08-21, décidé avec Léandre) : remplace la logique "6 tranches de
-- population" par un barème continu au nombre d'habitants + 3 formules de service (Autonomie /
-- Accompagné / Premium). Réutilise parametres_facturation (clé/valeur, migration 034) plutôt
-- qu'une nouvelle table — même esprit : rien n'est codé en dur, tout est éditable depuis le
-- backoffice (voir GET/PUT /administration/bareme-tarifaire).
--
-- Formule (voir worker/src/backoffice/tarification.ts pour l'implémentation, partagée entre le
-- backoffice et la landing page publique via GET /backoffice/tarifs-contenu) :
--   brut      = min(habitants, seuil_degressif) * taux_base + max(0, habitants - seuil_degressif) * taux_degressif
--   Autonomie = max(brut, prix_plancher)
--   Accompagné = Autonomie + supplement_accompagne (forfait fixe, pas par habitant : la
--                modération auto et les questionnaires hebdomadaires sont automatisés, leur coût
--                ne varie pas avec la taille de la commune)
--   Premium    = Accompagné + patrimoine la 1re année seulement (création de la chasse au trésor,
--                prix_patrimoine_premium = point de départ affiché, sur devis au-delà, conditionné
--                à l'hébergement/déplacement par la commune) ; à partir de la 2e année, Premium
--                revient au prix Accompagné (le patrimoine n'est pas refacturé chaque année)
--
-- L'ancienne grille par tranches (grille_tarifaire, migration 034) reste en place et continue de
-- servir aux devis de communes déjà clientes (trancheSuggeree côté fiche commune) : ce nouveau
-- barème est utilisé pour la landing page et pourra remplacer l'ancien système plus tard si
-- Léandre le souhaite, mais rien n'est cassé aujourd'hui.
INSERT INTO parametres_facturation (cle, valeur) VALUES
  ('bareme_taux_base', '1'),                    -- €/habitant en dessous du seuil
  ('bareme_seuil_degressif', '1000'),           -- habitants
  ('bareme_taux_degressif', '0.5'),             -- €/habitant au-delà du seuil
  ('bareme_prix_plancher', '250'),              -- € minimum, quelle que soit la population
  ('bareme_supplement_accompagne', '200'),      -- € forfait annuel, s'ajoute à Autonomie
  ('bareme_prix_patrimoine_premium', '749')     -- € point de départ, "sur devis" affiché au-delà
ON CONFLICT (cle) DO NOTHING;

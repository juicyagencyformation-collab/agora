-- db/migrations/034_facturation.sql
-- Suivi des abonnements (PAS un système de paiement en ligne — les communes règlent par
-- mandat administratif). Grille tarifaire éditable depuis le backoffice, par tranche de
-- population, + échéancier par commune avec rappel automatique.

-- Grille tarifaire : 6 tranches de population, prix TTC éditable (jamais codé en dur).
CREATE TABLE IF NOT EXISTS grille_tarifaire (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  population_min INTEGER NOT NULL,
  population_max INTEGER,              -- NULL = pas de plafond (dernière tranche, ex. "> 5000")
  prix_annuel_ttc NUMERIC NOT NULL DEFAULT 0,
  ordre INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Paramètres globaux de facturation (clé/valeur), ex. mois offerts pour un engagement 3 ans.
CREATE TABLE IF NOT EXISTS parametres_facturation (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);
INSERT INTO parametres_facturation (cle, valeur) VALUES ('mois_offerts_3ans', '3')
  ON CONFLICT (cle) DO NOTHING;

-- Seed des 6 tranches à 0 € (à éditer depuis le backoffice) — idempotent, ne s'exécute que si
-- la table est encore vide, pour ne jamais écraser des prix déjà saisis si la migration est
-- rejouée par erreur.
INSERT INTO grille_tarifaire (population_min, population_max, prix_annuel_ttc, ordre)
SELECT * FROM (VALUES
  (0, 299, 0::numeric, 1),
  (300, 499, 0::numeric, 2),
  (500, 899, 0::numeric, 3),
  (900, 1999, 0::numeric, 4),
  (2000, 4999, 0::numeric, 5),
  (5000, NULL::integer, 0::numeric, 6)
) AS v(population_min, population_max, prix_annuel_ttc, ordre)
WHERE NOT EXISTS (SELECT 1 FROM grille_tarifaire);

-- Échéancier par commune.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS prix_annuel_ttc NUMERIC;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS duree_engagement_mois INTEGER NOT NULL DEFAULT 12;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS prochaine_echeance DATE;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS derniere_relance_echeance_le TIMESTAMPTZ;

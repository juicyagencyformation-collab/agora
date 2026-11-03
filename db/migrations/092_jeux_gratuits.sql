-- db/migrations/092_jeux_gratuits.sql
-- 2026-11-03 (décision Léandre) : Chasse au trésor et Énigme photo entrent dans la version
-- gratuite — le même jour que l'ouverture des jeux aux habitants des autres communes (voir
-- worker/src/routes/jeux_ailleurs.ts). Fait en SQL et pas via Réglages → Palier gratuit : ce
-- bouton réappliquerait tout le périmètre et retirerait Conseil et Lois aux 9 communes qui les
-- ont gardés (migration 091).

-- 1) Palier gratuit (nouvelles communes, préréglage « Passer en Gratuit »)
INSERT INTO onglets_gratuits (cle) VALUES ('chasse_tresor'), ('enigmes')
ON CONFLICT (cle) DO NOTHING;

-- 2) Toutes les communes gratuites existantes reçoivent les deux onglets
INSERT INTO onglets_config (commune_id, cle, actif)
SELECT c.id, o.cle, true
FROM communes c
CROSS JOIN (VALUES ('chasse_tresor'), ('enigmes')) AS o(cle)
WHERE c.forfait = 'Gratuit'
  AND c.niveau_national IS NOT TRUE
ON CONFLICT (commune_id, cle) DO UPDATE SET actif = true;

-- 3) Email de présentation actif : les jeux ne sont plus présentés comme « modules avancés »
UPDATE modeles_email
SET corps_html = replace(replace(corps_html,
      '<p dir="ltr">✓ <strong>Actualités</strong> de la mairie, publiées en un clic</p>',
      '<p dir="ltr">✓ <strong>Actualités</strong> de la mairie, publiées en un clic</p><p dir="ltr">✓ <strong>Chasses au trésor et énigmes photo</strong> pour (re)découvrir le village</p>'),
      'mémoire du village, chasses aux trésors …)',
      'mémoire du village …)'),
    updated_at = now()
WHERE id = '32fff85e-a27c-48ee-832e-2703748a5ab0';

-- Vérification (attendu : 0 commune gratuite sans les deux jeux)
SELECT count(*) AS communes_gratuites_sans_jeux
FROM communes c
WHERE c.forfait = 'Gratuit' AND c.niveau_national IS NOT TRUE
  AND EXISTS (
    SELECT 1 FROM onglets_config oc
    WHERE oc.commune_id = c.id AND oc.cle IN ('chasse_tresor', 'enigmes') AND oc.actif = false
  );

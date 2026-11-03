-- db/migrations/091_gratuit_sans_conseil_lois.sql
-- 2026-11-03 (décision Léandre) : Conseil municipal et Lois sortent de la version gratuite.
-- Fait en SQL plutôt que via Réglages → Palier gratuit du backoffice : ce bouton réapplique le
-- périmètre à TOUTES les communes gratuites, sans exception possible. Or on garde l'acquis des
-- communes déjà utilisées (au moins un vrai compte : ni provisionné, ni supprimé, ni visiteur
-- démo, ni superadmin) — 9 communes au 2026-11-03.

-- 1) Palier gratuit (nouvelles communes, préréglage « Passer en Gratuit »)
DELETE FROM onglets_gratuits WHERE cle IN ('conseil', 'lois');

-- 2) Communes gratuites jamais utilisées : Conseil et Lois désactivés
--    (UPSERT : une commune sans ligne pour un onglet le verrait actif par défaut)
INSERT INTO onglets_config (commune_id, cle, actif)
SELECT c.id, o.cle, false
FROM communes c
CROSS JOIN (VALUES ('conseil'), ('lois')) AS o(cle)
WHERE c.forfait = 'Gratuit'
  AND c.niveau_national IS NOT TRUE
  AND c.acces_libre IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.commune_id = c.id
      AND u.compte_provisionne IS NOT TRUE
      AND u.compte_supprime_le IS NULL
      AND u.compte_visiteur_demo IS NOT TRUE
      AND u.role <> 'superadmin'
  )
ON CONFLICT (commune_id, cle) DO UPDATE SET actif = false;

-- 3) Email de présentation actif : les lois ne sont plus présentées comme incluses
UPDATE modeles_email
SET corps_html = replace(replace(corps_html,
      '<p dir="ltr">✓ <strong>Suivi des lois</strong> françaises et européennes</p>',
      '<p dir="ltr">✓ <strong>Actualités</strong> de la mairie, publiées en un clic</p>'),
      'Les modules avancés (actualités, conseil municipal, entraide entre voisins',
      'Les modules avancés (conseil municipal, suivi des lois françaises et européennes, entraide entre voisins'),
    updated_at = now()
WHERE id = '32fff85e-a27c-48ee-832e-2703748a5ab0';

-- Vérification : communes gratuites qui gardent Conseil et Lois (attendu : 9)
SELECT c.nom
FROM communes c
JOIN onglets_config oc ON oc.commune_id = c.id AND oc.cle = 'lois' AND oc.actif
WHERE c.forfait = 'Gratuit' AND c.niveau_national IS NOT TRUE
ORDER BY c.nom;

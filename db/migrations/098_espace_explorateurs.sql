-- db/migrations/098_espace_explorateurs.sql
-- Espace « Explorateurs » (2026-11-05, validé par Léandre) : les touristes et gens de passage
-- (aires de camping-car, randonneurs...) s'y créent un compte en une page, puis jouent aux chasses
-- au trésor et énigmes photo de n'importe quel village via routes/jeux_ailleurs.ts. Cet espace ne
-- contient AUCUN contenu de village : un compte Explorateur n'appartient à aucune commune, il ne
-- peut donc rien y lire. Le verrou côté Worker (middleware/explorateurs.ts) n'y laisse passer que
-- la connexion, le profil, les notifications et le jeu dans les villages.
--
-- niveau_national = true : drapeau « pas une commune cliente » déjà respecté partout (comptages,
-- palier gratuit, relances, prospection, statistiques publiques, recherche de villages à visiter).
-- partage_regional = false : aucun événement de cet espace n'apparaît dans les agendas des
-- communes. Responsable de traitement des comptes Explorateurs : Juicy Solutions (pas une mairie),
-- comptes anonymisés après 12 mois d'inactivité (cron.ts, purgerExplorateursInactifs).
INSERT INTO communes (slug, nom, population, niveau_national, partage_regional, forfait, statut_client)
SELECT 'explorateurs', 'Explorateurs', 0, true, false, 'Gratuit', 'active'
WHERE NOT EXISTS (SELECT 1 FROM communes WHERE slug = 'explorateurs');

-- Seuls les deux jeux restent actifs (masque les autres onglets dans l'app, en plus du verrou
-- serveur et du mode d'affichage Explorateur côté frontend).
INSERT INTO onglets_config (commune_id, cle, actif)
SELECT c.id, cle, (cle = ANY(ARRAY['chasse_tresor', 'enigmes']))
FROM communes c
CROSS JOIN unnest(ARRAY[
  'actualites', 'alertes', 'thermometre', 'mur', 'agenda', 'coups_de_main', 'chasse_tresor',
  'conseil', 'annuaire', 'bulletin', 'photo_du_jour', 'enigmes', 'lois', 'memoire'
]) AS cle
WHERE c.slug = 'explorateurs'
ON CONFLICT (commune_id, cle) DO UPDATE SET actif = EXCLUDED.actif;

-- Vérification : doit renvoyer une ligne, niveau_national = true.
SELECT id, slug, nom, niveau_national, partage_regional, statut_client FROM communes WHERE slug = 'explorateurs';

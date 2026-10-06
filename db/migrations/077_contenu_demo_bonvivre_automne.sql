-- db/migrations/077_contenu_demo_bonvivre_automne.sql
-- Complète le contenu de démo de "Bonvivre" (voir migration 075) avec 3 éléments à connotation
-- automne/hiver, pour qu'un prospect qui visite la démo en octobre-novembre ne voie pas que du
-- contenu d'été (retour utilisateur du 2026-10-06). Mêmes conventions que 075 : décalages
-- relatifs à now(), idempotent via NOT EXISTS sur le titre.
--
-- IMPORTANT : ces décalages doivent rester synchronisés avec la liste équivalente dans
-- rafraichirContenuDemoBonvivre (worker/src/cron.ts), qui les recale chaque nuit à 4h par
-- rapport à "maintenant" — sans quoi ce contenu redeviendrait daté comme celui de 075 avant lui.

INSERT INTO events (commune_id, user_id, titre, description, lieu, lat, lng, photo_url, r2_key, officiel, partage_autour, date_debut, date_fin, type_action, necessite_validation_presence, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Repas des aînés', 'Repas convivial offert par la mairie à tous les habitants de plus de 65 ans, animation musicale incluse.', 'Salle des fêtes',
       COALESCE(c.lat, 46.5) + 0.0003, COALESCE(c.lng, 2.5) - 0.0005, NULL, NULL,
       true, true, now() + interval '22 days', now() + interval '22 days' + interval '3 hours',
       NULL, false, now() - interval '4 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.commune_id = c.id AND e.titre = 'Repas des aînés');

INSERT INTO events (commune_id, user_id, titre, description, lieu, lat, lng, photo_url, r2_key, officiel, partage_autour, date_debut, date_fin, type_action, necessite_validation_presence, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Commémoration du 11 Novembre', 'Cérémonie au monument aux morts, suivie d''un pot offert par la municipalité.', 'Monument aux morts',
       COALESCE(c.lat, 46.5) - 0.0002, COALESCE(c.lng, 2.5) + 0.0002, NULL, NULL,
       true, false, now() + interval '18 days', now() + interval '18 days' + interval '1 hours',
       NULL, false, now() - interval '6 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.commune_id = c.id AND e.titre = 'Commémoration du 11 Novembre');

INSERT INTO articles (commune_id, auteur_id, section, categorie, titre, contenu_html, fichier_pv_url, fichier_pv_type, created_at, updated_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'actualites', 'vie_village', 'Collecte de jouets solidaire : donnez une seconde vie à vos jouets',
       '<p>Comme chaque année, une collecte de jouets en bon état est organisée jusqu''à mi-décembre au profit d''associations locales. Des points de dépôt sont disponibles à la mairie et à la bibliothèque.</p><p>Merci pour votre générosité !</p>',
       NULL, NULL, now() - interval '1 days', now() - interval '1 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.commune_id = c.id AND a.titre = 'Collecte de jouets solidaire : donnez une seconde vie à vos jouets');

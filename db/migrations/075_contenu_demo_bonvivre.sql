-- db/migrations/075_contenu_demo_bonvivre.sql
-- Peuple la commune de démonstration publique "Bonvivre" (voir frontend/accueil.html, démo live
-- embarquée sur la landing page) avec du contenu factice réaliste sur chaque module — pour qu'un
-- prospect qui ouvre la démo voie à quoi ressemble une commune réellement active, pas une coquille
-- vide. Auteur de tout ce contenu : le compte le plus ancien de la commune (quel qu'il soit —
-- maire, admin...), résolu dynamiquement, jamais codé en dur.
--
-- Idempotent : chaque INSERT est gardé par un NOT EXISTS sur un titre unique, donc rejouable sans
-- créer de doublons si exécuté plusieurs fois par erreur.
--
-- Note schéma (découvert en écrivant ce script) : articles.categorie, articles.fichier_pv_url/
-- _type, alertes.urgent et la table annuaire entière n'apparaissent dans AUCUNE migration
-- trackée — créés directement dans Supabase par le passé (même catégorie de dérive que les
-- tables Énigme photo, voir mémoire). Ce script fournit explicitement une valeur pour chaque
-- colonne que les routes applicatives (worker/src/routes/*.ts) renseignent toujours, pour rester
-- cohérent avec elles sans connaître le DDL exact.

-- ===================== Actualités =====================
INSERT INTO articles (commune_id, auteur_id, section, categorie, titre, contenu_html, fichier_pv_url, fichier_pv_type, created_at, updated_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'actualites', 'vie_village', 'Le marché du samedi fait son grand retour !',
       '<p>Après la pause hivernale, le marché retrouve la place de l''Église tous les samedis matin de 8h à 13h. Au programme : producteurs locaux, boulanger, fromager et quelques nouveaux venus à découvrir.</p><p>Venez nombreux pour soutenir les commerçants du village !</p>',
       NULL, NULL, now() - interval '2 days', now() - interval '2 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.commune_id = c.id AND a.titre = 'Le marché du samedi fait son grand retour !');

INSERT INTO articles (commune_id, auteur_id, section, categorie, titre, contenu_html, fichier_pv_url, fichier_pv_type, created_at, updated_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'actualites', 'projets_travaux', 'Travaux de réfection de la rue principale : ce qu''il faut savoir',
       '<p>La réfection de la chaussée de la rue principale débutera le mois prochain. Circulation alternée prévue pendant environ trois semaines, avec un accès piéton maintenu en permanence.</p><p>Merci de votre patience pendant ces travaux qui amélioreront durablement la voirie du centre-bourg.</p>',
       NULL, NULL, now() - interval '5 days', now() - interval '5 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.commune_id = c.id AND a.titre = 'Travaux de réfection de la rue principale : ce qu''il faut savoir');

INSERT INTO articles (commune_id, auteur_id, section, categorie, titre, contenu_html, fichier_pv_url, fichier_pv_type, created_at, updated_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'actualites', 'environnement', 'Un nouveau composteur collectif au quartier des Tilleuls',
       '<p>Un composteur partagé vient d''être installé au quartier des Tilleuls, à disposition de tous les habitants. Un petit guide est affiché sur place pour bien trier ses déchets organiques.</p>',
       NULL, NULL, now() - interval '9 days', now() - interval '9 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.commune_id = c.id AND a.titre = 'Un nouveau composteur collectif au quartier des Tilleuls');

INSERT INTO articles (commune_id, auteur_id, section, categorie, titre, contenu_html, fichier_pv_url, fichier_pv_type, created_at, updated_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'actualites', 'agenda', 'Fête de la musique : le programme complet',
       '<p>Scène ouverte place du village dès 18h, suivie des groupes locaux et d''un feu d''artifice pour clôturer la soirée. Buvette et restauration sur place au profit des associations.</p>',
       NULL, NULL, now() - interval '1 days', now() - interval '1 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.commune_id = c.id AND a.titre = 'Fête de la musique : le programme complet');

INSERT INTO articles (commune_id, auteur_id, section, categorie, titre, contenu_html, fichier_pv_url, fichier_pv_type, created_at, updated_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'actualites', 'info_pratique', 'Nouveaux horaires de la mairie à partir de septembre',
       '<p>À compter de la rentrée, le secrétariat de mairie sera ouvert du lundi au vendredi de 9h à 12h et de 14h à 17h, ainsi que le samedi matin de 9h à 12h. Fermeture le mercredi après-midi.</p>',
       NULL, NULL, now() - interval '12 days', now() - interval '12 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.commune_id = c.id AND a.titre = 'Nouveaux horaires de la mairie à partir de septembre');

-- ===================== Alertes / signalements =====================
INSERT INTO alertes (commune_id, user_id, titre, description, lat, lng, statut, urgent, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Fuite d''eau rue des Lilas', 'Une fuite importante est visible au niveau du trottoir, l''eau s''écoule en continu depuis ce matin.',
       COALESCE(c.lat, 46.5) + 0.0011, COALESCE(c.lng, 2.5) - 0.0007, 'ouverte', true, now() - interval '3 hours'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM alertes al WHERE al.commune_id = c.id AND al.titre = 'Fuite d''eau rue des Lilas');

INSERT INTO alertes (commune_id, user_id, titre, description, lat, lng, statut, urgent, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Nid de frelons près de l''école', 'Un nid a été repéré dans un arbre à l''entrée de l''école primaire. À signaler aux parents en attendant l''intervention.',
       COALESCE(c.lat, 46.5) - 0.0009, COALESCE(c.lng, 2.5) + 0.0014, 'en_cours', false, now() - interval '1 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM alertes al WHERE al.commune_id = c.id AND al.titre = 'Nid de frelons près de l''école');

INSERT INTO alertes (commune_id, user_id, titre, description, lat, lng, statut, urgent, created_at, reponse_officielle, reponse_par, reponse_le)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Éclairage public défaillant place de l''Église', 'Un lampadaire clignote et s''éteint par intermittence depuis quelques jours.',
       COALESCE(c.lat, 46.5) + 0.0004, COALESCE(c.lng, 2.5) + 0.0003, 'resolue', false, now() - interval '10 days',
       'Intervention réalisée par les services techniques, le lampadaire fonctionne de nouveau normalement. Merci pour le signalement !',
       (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1), now() - interval '7 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM alertes al WHERE al.commune_id = c.id AND al.titre = 'Éclairage public défaillant place de l''Église');

-- ===================== Coup de main (entraide) =====================
INSERT INTO coups_de_main (commune_id, user_id, type, titre, description, categorie, expires_at, contact, prix, disponibilites, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'offre', 'Je prête ma perceuse et mon établi', 'Petit outillage de bricolage à disposition des voisins, sur simple message. Rendu propre apprécié !',
       'bricolage', now() + interval '85 days', 'À convenir par message', NULL, 'Soirs et week-ends', now() - interval '4 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM coups_de_main cm WHERE cm.commune_id = c.id AND cm.titre = 'Je prête ma perceuse et mon établi');

INSERT INTO coups_de_main (commune_id, user_id, type, titre, description, categorie, expires_at, contact, prix, disponibilites, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'demande', 'Besoin d''aide pour tailler une haie', 'Une haie assez haute à tailler ce week-end, un coup de main serait le bienvenu (matériel sur place).',
       'jardinage', now() + interval '20 days', NULL, NULL, 'Samedi ou dimanche matin', now() - interval '2 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM coups_de_main cm WHERE cm.commune_id = c.id AND cm.titre = 'Besoin d''aide pour tailler une haie');

INSERT INTO coups_de_main (commune_id, user_id, type, titre, description, categorie, expires_at, contact, prix, disponibilites, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'offre', 'Disponible pour du babysitting occasionnel', 'Étudiante sérieuse, disponible quelques soirs par semaine pour garder vos enfants.',
       'garde_enfants', now() + interval '60 days', NULL, '10€/h', 'En semaine à partir de 18h', now() - interval '6 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM coups_de_main cm WHERE cm.commune_id = c.id AND cm.titre = 'Disponible pour du babysitting occasionnel');

INSERT INTO coups_de_main (commune_id, user_id, type, titre, description, categorie, expires_at, contact, prix, disponibilites, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'demande', 'Covoiturage recherché pour le marché de Noël', 'Je cherche une place pour le marché de Noël de la ville voisine le mois prochain, participation aux frais bien sûr.',
       'transport', now() + interval '25 days', 'Message via l''appli', NULL, NULL, now() - interval '1 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM coups_de_main cm WHERE cm.commune_id = c.id AND cm.titre = 'Covoiturage recherché pour le marché de Noël');

-- ===================== Annuaire =====================
INSERT INTO annuaire (commune_id, user_id, nom, categorie, description, telephone, email, site_web, logo_r2_key, logo_url)
SELECT c.id, NULL, 'Boulangerie Au Bon Pain', 'commerce', 'Pain artisanal, viennoiseries et pâtisseries, cuits au feu de bois tous les matins.',
       '03 00 00 00 01', 'contact@aubonpain-bonvivre.fr', NULL, NULL, NULL
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM annuaire an WHERE an.commune_id = c.id AND an.nom = 'Boulangerie Au Bon Pain');

INSERT INTO annuaire (commune_id, user_id, nom, categorie, description, telephone, email, site_web, logo_r2_key, logo_url)
SELECT c.id, NULL, 'Menuiserie Lefèvre', 'artisan', 'Fabrication et pose de menuiseries bois sur mesure, devis gratuit.',
       '03 00 00 00 02', 'contact@menuiserie-lefevre.fr', NULL, NULL, NULL
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM annuaire an WHERE an.commune_id = c.id AND an.nom = 'Menuiserie Lefèvre');

INSERT INTO annuaire (commune_id, user_id, nom, categorie, description, telephone, email, site_web, logo_r2_key, logo_url)
SELECT c.id, NULL, 'Les Amis de Bonvivre', 'association', 'Association locale organisant animations, vide-greniers et sorties conviviales tout au long de l''année.',
       NULL, 'lesamisdebonvivre@email.fr', NULL, NULL, NULL
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM annuaire an WHERE an.commune_id = c.id AND an.nom = 'Les Amis de Bonvivre');

INSERT INTO annuaire (commune_id, user_id, nom, categorie, description, telephone, email, site_web, logo_r2_key, logo_url)
SELECT c.id, NULL, 'Agence postale communale', 'service_public', 'Affranchissement, retrait de colis et opérations courantes, au sein de la mairie.',
       '03 00 00 00 03', NULL, NULL, NULL, NULL
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM annuaire an WHERE an.commune_id = c.id AND an.nom = 'Agence postale communale');

INSERT INTO annuaire (commune_id, user_id, nom, categorie, description, telephone, email, site_web, logo_r2_key, logo_url)
SELECT c.id, NULL, 'Cabinet infirmier Bonvivre Santé', 'professionnel', 'Soins à domicile et au cabinet, sur rendez-vous ou en urgence.',
       '03 00 00 00 04', NULL, NULL, NULL, NULL
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM annuaire an WHERE an.commune_id = c.id AND an.nom = 'Cabinet infirmier Bonvivre Santé');

-- ===================== Chasse au trésor (mode balade) =====================
WITH nouvelle_balade AS (
  INSERT INTO chasses_tresor (commune_id, user_id, titre, description, actif, mode, rayon_metres)
  SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
         'Balade découverte de Bonvivre', 'Une balade en famille pour (re)découvrir les lieux emblématiques du village, à son rythme.',
         true, 'balade', 60
  FROM communes c
  WHERE c.slug = 'bonvivre'
    AND NOT EXISTS (SELECT 1 FROM chasses_tresor ch WHERE ch.commune_id = c.id AND ch.titre = 'Balade découverte de Bonvivre')
  RETURNING id, commune_id
)
INSERT INTO etapes_chasse (commune_id, chasse_id, ordre, titre, indice, lat, lng, qr_token, type_contenu)
SELECT nb.commune_id, nb.id, v.ordre, v.titre, v.indice,
       COALESCE((SELECT lat FROM communes WHERE id = nb.commune_id), 46.5) + v.dlat,
       COALESCE((SELECT lng FROM communes WHERE id = nb.commune_id), 2.5) + v.dlng,
       gen_random_uuid(), 'aucun'
FROM nouvelle_balade nb
CROSS JOIN (VALUES
  (0, 'La boulangerie', 'Direction l''odeur du pain chaud, au cœur du village.', 0.0008::double precision, 0.0006::double precision),
  (1, 'L''église', 'Le clocher vous indique le chemin depuis toujours.', -0.0005::double precision, 0.0012::double precision),
  (2, 'L''école', 'Là où résonnent les rires des enfants.', 0.0015::double precision, -0.0004::double precision),
  (3, 'Le parc communal', 'Un coin de verdure pour reprendre son souffle.', -0.0012::double precision, -0.0009::double precision)
) AS v(ordre, titre, indice, dlat, dlng);

-- ===================== Agenda =====================
INSERT INTO events (commune_id, user_id, titre, description, lieu, lat, lng, photo_url, r2_key, officiel, partage_autour, date_debut, date_fin, type_action, necessite_validation_presence, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Marché hebdomadaire', 'Marché de producteurs locaux, place de l''Église.', 'Place de l''Église',
       COALESCE(c.lat, 46.5) + 0.0004, COALESCE(c.lng, 2.5) + 0.0003, NULL, NULL,
       true, true, now() + interval '4 days', now() + interval '4 days' + interval '5 hours',
       NULL, false, now() - interval '2 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.commune_id = c.id AND e.titre = 'Marché hebdomadaire');

INSERT INTO events (commune_id, user_id, titre, description, lieu, lat, lng, photo_url, r2_key, officiel, partage_autour, date_debut, date_fin, type_action, necessite_validation_presence, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Conseil municipal ouvert au public', 'Séance publique du conseil municipal, salle de la mairie.', 'Salle du conseil, mairie',
       COALESCE(c.lat, 46.5), COALESCE(c.lng, 2.5), NULL, NULL,
       true, false, now() + interval '9 days', now() + interval '9 days' + interval '2 hours',
       NULL, false, now() - interval '3 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.commune_id = c.id AND e.titre = 'Conseil municipal ouvert au public');

INSERT INTO events (commune_id, user_id, titre, description, lieu, lat, lng, photo_url, r2_key, officiel, partage_autour, date_debut, date_fin, type_action, necessite_validation_presence, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Fête de la musique', 'Scène ouverte, groupes locaux et feu d''artifice pour clôturer la soirée.', 'Place du village',
       COALESCE(c.lat, 46.5) + 0.0002, COALESCE(c.lng, 2.5) - 0.0002, NULL, NULL,
       true, true, now() + interval '14 days', now() + interval '14 days' + interval '6 hours',
       NULL, false, now() - interval '1 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.commune_id = c.id AND e.titre = 'Fête de la musique');

INSERT INTO events (commune_id, user_id, titre, description, lieu, lat, lng, photo_url, r2_key, officiel, partage_autour, date_debut, date_fin, type_action, necessite_validation_presence, created_at)
SELECT c.id, (SELECT id FROM users WHERE commune_id = c.id ORDER BY created_at ASC LIMIT 1),
       'Atelier compostage', 'Atelier gratuit et ouvert à tous pour apprendre à bien utiliser le composteur collectif.', 'Quartier des Tilleuls',
       COALESCE(c.lat, 46.5) - 0.0006, COALESCE(c.lng, 2.5) + 0.0005, NULL, NULL,
       true, false, now() + interval '6 days', now() + interval '6 days' + interval '2 hours',
       NULL, false, now() - interval '5 days'
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.commune_id = c.id AND e.titre = 'Atelier compostage');

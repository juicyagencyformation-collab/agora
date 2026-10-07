-- db/migrations/078_corrections_demo_bonvivre_automne.sql
-- Corrige 3 problèmes repérés sur la démo "Bonvivre" par un retour utilisateur du 2026-10-07 :
--
-- 1. 4 lignes de la table events, créées à la main le 21/08 (jamais vues dans aucune migration
--    trackée), utilisées comme bricolage pour rester "toujours en tête" de l'agenda via un
--    date_fin fixé en 2050+ — alors que ce sont des infos pratiques (annuaire de prestataires),
--    pas des événements. Elles squattaient la première place de l'agenda ET du widget "En un
--    coup d'œil" de l'accueil (qui prend events[0]). On les retire de l'agenda.
-- 2. "Fête de la musique" (événement + actu associée) semée par la migration 075 avec un
--    décalage relatif ("dans 14 jours") — une fête qui a vraiment lieu le 21 juin ne doit
--    jamais apparaître en octobre. Renommée en "Halloween des enfants", seul le titre/texte
--    change ici : les dates sont recalculées dès ce soir par rafraichirContenuDemoBonvivre
--    (worker/src/cron.ts), qui ancre désormais cet événement sur la vraie date du 31 octobre.
-- 3. "Commémoration du 11 Novembre" avait le même défaut (décalage relatif "+18 jours" au lieu
--    d'être ancrée sur la vraie date) — aucun changement de texte nécessaire ici, seul le cron
--    corrige sa date désormais (ancrée sur le 11/11 à 11h00).
--
-- Idempotent : UPDATE/DELETE par titre, sans effet si rejoué.

DELETE FROM events
WHERE commune_id = (SELECT id FROM communes WHERE slug = 'bonvivre')
  AND titre IN (
    'AIDE AUX COURSES',
    'TÉLÉALARME — rechercher-un-prestataire',
    'TÉLÉALARME — aide partielle de l''ANGDM',
    'AIDE JARDINIER'
  );

UPDATE events
SET titre = 'Halloween des enfants',
    description = 'Défilé déguisé et chasse aux bonbons dans les rues du village, organisé avec les associations locales. Un chocolat chaud offert au retour, place de l''Église.'
WHERE commune_id = (SELECT id FROM communes WHERE slug = 'bonvivre')
  AND titre = 'Fête de la musique';

UPDATE articles
SET titre = 'Halloween des enfants : le programme complet',
    contenu_html = '<p>Rendez-vous le 31 octobre dès 18h pour un défilé déguisé dans les rues du village, suivi d''une distribution de bonbons et d''un chocolat chaud offert aux familles, place de l''Église.</p><p>Déguisements maison bienvenus, l''essentiel est de s''amuser !</p>'
WHERE commune_id = (SELECT id FROM communes WHERE slug = 'bonvivre')
  AND titre = 'Fête de la musique : le programme complet';

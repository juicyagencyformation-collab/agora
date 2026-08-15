-- db/migrations/035_commune_demo_gratuite.sql
-- Commune de démonstration limitée au palier GRATUIT (actualités, agenda, alertes, annuaire),
-- utilisée par le lien de démo dans l'email de prospection (au lieu d'Eaucourt, qui reste la
-- vraie commune de Léandre avec tout activé — on n'y touche pas).
INSERT INTO communes (slug, nom, population, niveau_national, forfait)
SELECT 'decouverte-gratuite', 'Commune de démonstration', 800, false, 'Gratuit'
WHERE NOT EXISTS (SELECT 1 FROM communes WHERE slug = 'decouverte-gratuite');

-- Onglets : seul le palier gratuit est actif (doit rester en phase avec la liste ONGLETS_VALIDES
-- de worker/src/routes/moderation.ts et le préréglage du backoffice).
INSERT INTO onglets_config (commune_id, cle, actif)
SELECT c.id, cle, (cle = ANY(ARRAY['actualites', 'agenda', 'alertes', 'annuaire']))
FROM communes c
CROSS JOIN unnest(ARRAY[
  'actualites', 'alertes', 'thermometre', 'mur', 'agenda', 'coups_de_main', 'chasse_tresor',
  'conseil', 'annuaire', 'bulletin', 'photo_du_jour', 'enigmes', 'lois', 'memoire'
]) AS cle
WHERE c.slug = 'decouverte-gratuite'
ON CONFLICT (commune_id, cle) DO NOTHING;

-- Compte maire de démonstration, pour piloter/peupler cette commune avec du contenu d'exemple.
-- Mot de passe temporaire 'demo-agora-2026' (hash SHA-256 simple ici, PostgreSQL n'ayant pas
-- accès à PBKDF2) — bascule automatiquement en PBKDF2 salé à la première connexion, comme pour
-- les comptes staff (voir worker/src/lib/password.ts). À CHANGER après la première connexion.
INSERT INTO users (commune_id, email, password_hash, nom, prenom, role, consentement_rgpd_le)
SELECT c.id, 'demo@plateforme-agora.fr', encode(digest('demo-agora-2026', 'sha256'), 'hex'),
       'Démo', 'Agora', 'maire', now()
FROM communes c
WHERE c.slug = 'decouverte-gratuite'
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.commune_id = c.id AND u.email = 'demo@plateforme-agora.fr'
  );

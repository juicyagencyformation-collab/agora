-- db/migrations/076_acces_libre_demo.sql
-- Permet à une commune de démonstration publique (Bonvivre, voir frontend/accueil.html, démo
-- live embarquée sur la landing page) d'être visitée sans compte ni identifiants : un visiteur
-- sans session valide se voit attribuer automatiquement le compte "Visiteur Démo" partagé
-- ci-dessous (voir POST /:slug/auth/entrer-demo dans worker/src/auth.ts), plutôt que d'être
-- renvoyé vers la page de connexion. Jamais activé par défaut, jamais via l'interface backoffice
-- pour l'instant — décision volontaire du 2026-10-06, uniquement en base (même logique que
-- superadmin/maire, réservés eux aussi à une attribution manuelle).
ALTER TABLE communes ADD COLUMN IF NOT EXISTS acces_libre BOOLEAN NOT NULL DEFAULT false;

-- Marque le compte auto-attribué aux visiteurs anonymes d'une commune en acces_libre — permet de
-- le retrouver sans dépendre d'un email figé ni du premier compte créé (qui pourrait être un vrai
-- citoyen si la commune en gagne un jour). role='citoyen' strict et immuable : jamais de pouvoir
-- de modération sur ce compte, partagé entre tous les visiteurs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS compte_visiteur_demo BOOLEAN NOT NULL DEFAULT false;

UPDATE communes SET acces_libre = true WHERE slug = 'bonvivre';

-- Hash aléatoire et non communiqué : ce compte n'est JAMAIS censé être utilisable via
-- POST /auth/login (mot de passe + email) — seulement via /auth/entrer-demo, qui ne vérifie
-- aucun mot de passe. Un hash imprévisible ferme cette porte dérivée sans code supplémentaire.
INSERT INTO users (commune_id, email, password_hash, nom, prenom, role, compte_visiteur_demo, consentement_rgpd_le)
SELECT c.id, 'visiteur@bonvivre.demo', encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
       'Démo', 'Visiteur', 'citoyen', true, now()
FROM communes c
WHERE c.slug = 'bonvivre'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.commune_id = c.id AND u.compte_visiteur_demo = true);

-- db/migrations/007_donnees_test.sql
-- Insère une commune de test et un compte superadmin.
-- ⚠️ Le hash ci-dessous correspond au mot de passe : test1234
-- (SHA-256 — cohérent avec la fonction hasherMotDePasse de auth.ts)
-- Change le mot de passe après ton premier test en te recréant un compte,
-- ou en recalculant un hash SHA-256 d'un autre mot de passe.

INSERT INTO communes (slug, nom, population)
VALUES ('eaucourt', 'Eaucourt-sur-Somme', 450)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (commune_id, nom, prenom, email, password_hash, role)
SELECT id, 'Sallé', 'Léandre', 'test@eaucourt.fr',
  '937e8d5fbb48bd4949536cd65b8d35c426b80d2f830c5c308e2cdec422ae2244', -- SHA-256 de "test1234"
  'superadmin'
FROM communes WHERE slug = 'eaucourt'
ON CONFLICT (commune_id, email) DO NOTHING;

INSERT INTO onglets_config (commune_id, cle, actif)
SELECT c.id, cle, true
FROM communes c, unnest(ARRAY[
  'actualites','alertes','thermometre','mur','agenda',
  'coups_de_main','chasse_tresor','conseil','profil'
]) AS cle
WHERE c.slug = 'eaucourt'
ON CONFLICT (commune_id, cle) DO NOTHING;

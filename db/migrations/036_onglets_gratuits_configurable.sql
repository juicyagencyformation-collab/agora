-- db/migrations/036_onglets_gratuits_configurable.sql
-- Rend la définition du palier "Gratuit" pilotable depuis le backoffice au lieu d'être figée
-- dans le code (ONGLETS_GRATUITS dans administration.ts). Une ligne = un module inclus dans le
-- gratuit. Modifier cette liste depuis le backoffice réapplique immédiatement le nouveau
-- périmètre à TOUTES les communes actuellement sur forfait = 'Gratuit' (changement global et
-- rétroactif, décidé avec Léandre le 2026-08-15).
CREATE TABLE IF NOT EXISTS onglets_gratuits (
  cle text PRIMARY KEY
);

-- Seed avec le périmètre actuel (agenda + alertes).
INSERT INTO onglets_gratuits (cle) VALUES ('agenda'), ('alertes')
ON CONFLICT (cle) DO NOTHING;

-- Application immédiate et rétroactive à toutes les communes déjà sur le palier gratuit
-- (dont decouverte-gratuite, migration 035, qui avait été seedée avec 4 modules) — pour que
-- la base reflète tout de suite le nouveau périmètre sans attendre un premier clic dans le
-- backoffice.
UPDATE onglets_config oc
SET actif = (oc.cle IN ('agenda', 'alertes'))
FROM communes c
WHERE oc.commune_id = c.id
  AND c.forfait = 'Gratuit'
  AND oc.cle IN (
    'actualites', 'alertes', 'thermometre', 'mur', 'agenda', 'coups_de_main', 'chasse_tresor',
    'conseil', 'annuaire', 'bulletin', 'photo_du_jour', 'enigmes', 'lois', 'memoire'
  );

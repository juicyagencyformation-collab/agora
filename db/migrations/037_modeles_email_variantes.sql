-- db/migrations/037_modeles_email_variantes.sql
-- Passe modeles_email d'une ligne fixe par cle a plusieurs variantes nommees, pour permettre
-- l'A/B testing de l'email de prospection : chaque variante a un nom et un statut actif/inactif,
-- une seule active a la fois par cle — c'est elle qui part dans tous les envois (voir
-- chargerModelePresentation dans worker/src/backoffice/email-commune.ts). cle reste le TYPE de
-- modele ('presentation', 'fiche') ; nom distingue les variantes entre elles pour un meme cle.
ALTER TABLE modeles_email ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE modeles_email ADD COLUMN IF NOT EXISTS nom TEXT;
ALTER TABLE modeles_email ADD COLUMN IF NOT EXISTS actif BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE modeles_email ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE modeles_email SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE modeles_email SET nom = 'Variante A' WHERE nom IS NULL AND cle = 'presentation';
UPDATE modeles_email SET nom = 'Défaut' WHERE nom IS NULL;

ALTER TABLE modeles_email ALTER COLUMN id SET NOT NULL;
ALTER TABLE modeles_email ALTER COLUMN nom SET NOT NULL;
ALTER TABLE modeles_email DROP CONSTRAINT IF EXISTS modeles_email_pkey;
ALTER TABLE modeles_email ADD PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS idx_modeles_email_cle ON modeles_email (cle);
-- Une seule variante active par cle (l'activation d'une nouvelle variante doit d'abord
-- désactiver les autres du même cle, voir POST /modeles-presentation/:id/activer).
CREATE UNIQUE INDEX IF NOT EXISTS idx_modeles_email_cle_actif ON modeles_email (cle) WHERE actif;

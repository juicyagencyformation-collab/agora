-- db/migrations/100_espaces_citoyens_et_inscriptions.sql
-- 2026-11-06, validé par Léandre : ouvrir l'espace de toute commune de France aux habitants,
-- proprement sur le plan juridique et sans ouvrir la porte aux robots.

-- 1. « Rejoindre ma commune » ne crée plus RIEN avant la confirmation de l'email : la demande
--    peut viser une commune pas encore ouverte (prospect seul). L'espace de la commune n'est créé
--    qu'au clic sur le lien de confirmation (decouverte.ts, creer-compte). Avant, un robot pouvait
--    créer en masse des espaces de communes et faire partir des milliers d'emails.
ALTER TABLE activations_libres ADD COLUMN IF NOT EXISTS prospect_id UUID REFERENCES prospects(id);
ALTER TABLE activations_libres ALTER COLUMN commune_id DROP NOT NULL;

-- 2. Espace officiel (adopté par la mairie) ou espace citoyen (ouvert par les habitants, non géré
--    par la mairie). Tant qu'il est citoyen : bandeau « non géré par la mairie » dans l'app et
--    Juicy Solutions responsable du traitement (confidentialite.html). Il devient officiel quand un
--    compte mairie s'en sert (auth.ts, /me) ou depuis le backoffice (fiche commune).
ALTER TABLE communes ADD COLUMN IF NOT EXISTS espace_officiel BOOLEAN NOT NULL DEFAULT false;

-- Rattrapage : communes réellement adoptées au 2026-11-06 (63 attendues) — offre payante ou
-- fondatrice, vrai compte mairie, ou compte mairie créé automatiquement ET déjà utilisé. La date
-- d'acceptation des CGU n'est PAS un critère : la migration 080 l'a posée sur tous les comptes
-- administrateurs existants, y compris ceux jamais ouverts.
UPDATE communes c SET espace_officiel = true
WHERE NOT c.niveau_national
  AND (
    (c.forfait IS NOT NULL AND c.forfait <> 'Gratuit')
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.commune_id = c.id
        AND u.role IN ('admin', 'elu', 'maire')
        AND u.compte_supprime_le IS NULL
        AND (NOT u.compte_provisionne OR u.derniere_connexion_streak IS NOT NULL)
    )
  );

-- Vérification : environ 63 espaces officiels, le reste citoyens.
SELECT espace_officiel, count(*) FROM communes WHERE NOT niveau_national GROUP BY espace_officiel;

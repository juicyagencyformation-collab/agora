-- db/migrations/089_dpa_communes.sql
-- Informations propres à chaque commune pour compléter son contrat DPA (art. 28 RGPD), saisies
-- depuis le panneau du document dans le backoffice (worker/src/backoffice/facturation.ts).
-- Une ligne par commune. Champ vide = repris automatiquement d'une autre source si elle existe
-- (convention « Commune fondatrice », annuaire de prospection, compte du maire).
CREATE TABLE IF NOT EXISTS dpa_communes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id uuid NOT NULL UNIQUE REFERENCES communes(id) ON DELETE CASCADE,
  signataire_nom text,
  signataire_qualite text,
  siret_commune text,
  adresse_mairie text,
  habilitation text,
  telephone_alerte text,
  dpo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Clauses du Prestataire, identiques pour toutes les communes (article 17).
INSERT INTO parametres_facturation (cle, valeur) VALUES
  ('dpa_plafond_responsabilite', ''),
  ('dpa_assurance', '')
ON CONFLICT (cle) DO NOTHING;

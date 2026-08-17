-- db/migrations/042_devis_factures.sql
-- Devis -> bon de commande -> facture, pour la vente de la version complète aux communes.
-- Numérotation séquentielle SANS TROU par table (obligation légale sur les factures, Code de
-- commerce ; bonne pratique reprise ici pour les devis). L'envoi effectif d'une facture à une
-- commune (administration publique) doit ensuite passer par Chorus Pro, obligatoire depuis 2020
-- — hors périmètre technique de ce module, qui génère un PDF conforme à déposer manuellement
-- (décision prise avec Léandre le 2026-08-17 : pas d'intégration API Chorus Pro pour l'instant).
CREATE TABLE IF NOT EXISTS devis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT NOT NULL UNIQUE,
  commune_id UUID REFERENCES communes(id) ON DELETE SET NULL,
  nom_destinataire TEXT NOT NULL,
  adresse_destinataire TEXT,
  objet TEXT NOT NULL,
  montant_ht NUMERIC NOT NULL,
  taux_tva NUMERIC NOT NULL DEFAULT 0,
  montant_ttc NUMERIC NOT NULL,
  duree_engagement_mois INTEGER,
  validite_jours INTEGER NOT NULL DEFAULT 30,
  statut TEXT NOT NULL DEFAULT 'envoye',        -- envoye | accepte | refuse | expire
  bon_commande_recu_le TIMESTAMPTZ,
  bon_commande_reference TEXT,
  facture_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devis_commune ON devis (commune_id);

CREATE TABLE IF NOT EXISTS factures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT NOT NULL UNIQUE,
  devis_id UUID REFERENCES devis(id) ON DELETE SET NULL,
  commune_id UUID REFERENCES communes(id) ON DELETE SET NULL,
  nom_destinataire TEXT NOT NULL,
  adresse_destinataire TEXT,
  objet TEXT NOT NULL,
  montant_ht NUMERIC NOT NULL,
  taux_tva NUMERIC NOT NULL DEFAULT 0,
  montant_ttc NUMERIC NOT NULL,
  date_emission DATE NOT NULL DEFAULT CURRENT_DATE,
  date_echeance DATE,
  statut TEXT NOT NULL DEFAULT 'emise',          -- emise | deposee_chorus | payee
  deposee_chorus_le TIMESTAMPTZ,
  payee_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_factures_commune ON factures (commune_id);

-- Informations légales de l'émetteur (Juicy Solutions), éditables depuis le backoffice —
-- jamais codées en dur, pour pouvoir les corriger sans redéploiement. Valeurs connues seedées,
-- le reste à compléter (Réglages > Informations légales) avant le premier vrai devis/facture.
-- entreprise_siret : SIREN connu (882992472, 9 chiffres) — à compléter en SIRET complet
-- (14 chiffres, + l'établissement) avant usage réel.
INSERT INTO parametres_facturation (cle, valeur) VALUES
  ('entreprise_raison_sociale', 'Juicy Solutions'),
  ('entreprise_forme_juridique', ''),
  ('entreprise_siret', '882992472'),
  ('entreprise_adresse', ''),
  ('entreprise_cp_ville', ''),
  ('entreprise_email', 'contact@plateforme-agora.fr'),
  ('entreprise_telephone', '0648061097'),
  ('entreprise_iban', ''),
  ('entreprise_bic', ''),
  ('entreprise_mention_tva', 'TVA non applicable, art. 293 B du CGI'),
  ('entreprise_delai_paiement_jours', '30'),
  ('entreprise_taux_penalites', '')
ON CONFLICT (cle) DO NOTHING;

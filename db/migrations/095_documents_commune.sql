-- db/migrations/095_documents_commune.sql
-- Étape 4b du remaniement du backoffice (2026-11-04) : dossier documentaire par commune (onglet
-- Dossier de la fiche). Documents signés : convention, contrat DPA, délibération, bon de commande,
-- attestation d'assurance... Les fichiers vivent dans un bucket R2 PRIVÉ séparé
-- (agora-documents-eu, binding BUCKET_DOCUMENTS) — jamais dans agora-uploads-eu, qui est public via
-- cdn.plateforme-agora.fr. Téléchargement uniquement par le backoffice, session staff obligatoire.
CREATE TABLE IF NOT EXISTS documents_commune (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('convention', 'dpa', 'deliberation', 'bon_commande', 'attestation_assurance', 'devis_signe', 'autre')),
  libelle TEXT,
  signe_le DATE,
  r2_key TEXT NOT NULL UNIQUE,
  nom_fichier TEXT NOT NULL,
  content_type TEXT NOT NULL,
  taille_octets INTEGER NOT NULL,
  depose_par UUID REFERENCES staff_backoffice(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_commune_commune ON documents_commune (commune_id, created_at DESC);

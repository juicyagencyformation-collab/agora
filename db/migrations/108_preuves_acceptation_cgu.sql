-- db/migrations/108_preuves_acceptation_cgu.sql
-- 2026-11-20, demandé par Léandre : pouvoir PROUVER, en cas de contrôle, qu'une commune en offre
-- gratuite a accepté l'accord de sous-traitance RGPD (art. 28) intégré aux CGU (article 10).
-- Le RGPD exige un contrat écrit (art. 28.9 : la forme électronique suffit), pas une signature
-- manuscrite : la preuve, c'est ce journal + le texte exact accepté.
--
-- Remplace, comme preuve, users.cgu_sous_traitance_acceptee_le (migration 080), qui ne disait ni
-- quel texte, ni d'où, et que la migration 080 avait posé d'office sur tous les comptes mairie
-- existants. Cette colonne reste mise à jour (compatibilité) mais n'est plus lue par la gate.
-- Logique : worker/src/lib/cgu.ts. Tests : worker/test/auth-cgu-soustraitance.test.ts.

-- Texte intégral de chaque version des CGU réellement servie, archivé automatiquement au premier
-- clic « J'accepte » qui la rencontre. Table de référence commune à toute la plateforme (même
-- texte pour toutes les communes) : pas de commune_id, comme parametres_facturation.
CREATE TABLE IF NOT EXISTS versions_cgu (
  empreinte_sha256 TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  texte_html TEXT NOT NULL,
  url_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Journal des acceptations, en ajout seulement (aucune route ne le modifie ni ne le supprime).
-- Nom, email et rôle sont FIGÉS au moment du clic : la preuve survit à l'anonymisation du compte
-- (user_id passe alors à NULL si la ligne users disparaît, la personne reste identifiée).
CREATE TABLE IF NOT EXISTS acceptations_cgu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  version TEXT NOT NULL,
  empreinte_sha256 TEXT REFERENCES versions_cgu(empreinte_sha256),
  nom_affiche TEXT,
  email TEXT,
  role TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  -- Accusé de réception envoyé par email (preuve détenue aussi par un tiers : la boîte de la mairie
  -- et le journal d'envoi de Resend) : destinataires et identifiant Resend. NULL si non parti.
  accuse_envoye_a TEXT,
  accuse_email_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_acceptations_cgu_commune
  ON acceptations_cgu (commune_id, created_at DESC);

-- db/migrations/118_avoirs.sql
-- 2026-11-22, demandé par Léandre : factures d'avoir. Une facture émise ne se supprime jamais
-- (numérotation continue, conservation 10 ans) : on l'annule, en tout ou partie, par un avoir.
-- - Série de numéros dédiée, sans trou : A-AAAA-NNNN (même règle que F- et D-, facturation.ts).
-- - Plusieurs avoirs partiels possibles sur une facture, jamais plus que son montant TTC (contrôlé
--   par le Worker) ; quand la somme des avoirs atteint le montant, la facture passe « annulee ».
-- - Identité du destinataire recopiée depuis la facture (comme factures/devis : jamais recalculée).
-- - Statut : emis → depose_chorus (si la facture d'origine est sur Chorus Pro) → rembourse (si
--   la facture avait déjà été payée).
-- commune_id NULL = avoir sur une facture « libre » (hors commune), comme pour les factures.
-- Logique : worker/src/backoffice/facturation.ts (POST /factures/:id/avoirs, PATCH /avoirs/:id).
CREATE TABLE IF NOT EXISTS avoirs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT NOT NULL UNIQUE,
  facture_id UUID NOT NULL REFERENCES factures(id) ON DELETE RESTRICT,
  commune_id UUID REFERENCES communes(id) ON DELETE SET NULL,
  nom_destinataire TEXT NOT NULL,
  adresse_destinataire TEXT,
  motif TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('total', 'partiel')),
  montant_ht NUMERIC NOT NULL CHECK (montant_ht > 0),
  taux_tva NUMERIC NOT NULL DEFAULT 0,
  montant_ttc NUMERIC NOT NULL CHECK (montant_ttc > 0),
  date_emission DATE NOT NULL DEFAULT CURRENT_DATE,
  statut TEXT NOT NULL DEFAULT 'emis' CHECK (statut IN ('emis', 'depose_chorus', 'rembourse')),
  deposee_chorus_le TIMESTAMPTZ,
  rembourse_le TIMESTAMPTZ,
  -- Facture payée puis entièrement annulée : l'échéance de la commune a été reculée d'autant.
  echeance_reculee BOOLEAN NOT NULL DEFAULT false,
  cree_par UUID REFERENCES staff_backoffice(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_avoirs_facture ON avoirs (facture_id);
CREATE INDEX IF NOT EXISTS idx_avoirs_commune ON avoirs (commune_id);

-- Facture entièrement couverte par des avoirs : statut « annulee » (texte libre, pas de CHECK sur
-- factures.statut) et date d'annulation. payee_le est conservé : il dit si un remboursement est dû.
ALTER TABLE factures ADD COLUMN IF NOT EXISTS annulee_le TIMESTAMPTZ;

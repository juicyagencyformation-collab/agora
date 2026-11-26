-- db/migrations/122_publications_commerces_moderation.sql
-- 2026-11-26, demandé par Léandre : ouvrir les publications aux commerces et artisans, partager les
-- actualités entre communes voisines, et donner à la mairie des outils de modération motivée
-- (règlement européen sur les services numériques, art. 17 : l'auteur est informé du motif).
-- Logique : worker/src/lib/associations.ts (qui peut publier, quotas, suspension),
-- worker/src/lib/moderation-publications.ts (retrait motivé, suspension, masquage d'un partage),
-- worker/src/routes/decouverte.ts (« Autour de moi » : événements ET actualités partagés).

-- Actualité partagée avec les communes voisines (« Autour de moi »), comme events.partage_autour.
-- Faux par défaut : une actualité reste dans la commune sauf choix explicite.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS partage_autour BOOLEAN NOT NULL DEFAULT false;

-- Suspension des publications d'une fiche (association, commerce, artisan) par la mairie.
ALTER TABLE annuaire ADD COLUMN IF NOT EXISTS publications_suspendues_jusqu DATE;
ALTER TABLE annuaire ADD COLUMN IF NOT EXISTS publications_suspension_motif TEXT;

-- Historique des décisions de modération de la mairie : preuve en cas de contestation.
CREATE TABLE IF NOT EXISTS moderation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('retrait', 'restauration', 'suspension', 'fin_suspension', 'masquage_partage', 'fin_masquage_partage')),
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  fiche_id UUID REFERENCES annuaire(id) ON DELETE SET NULL,
  motif TEXT,
  precision TEXT,
  jusqu_au DATE,
  decide_par UUID REFERENCES users(id) ON DELETE SET NULL,
  auteur_prevenu BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moderation_decisions_commune ON moderation_decisions (commune_id, created_at DESC);

-- Contenu partagé par une AUTRE commune, masqué dans « Autour de moi » de cette commune-ci.
CREATE TABLE IF NOT EXISTS partages_masques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  masque_par UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((article_id IS NULL) <> (event_id IS NULL)),
  UNIQUE (commune_id, article_id),
  UNIQUE (commune_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_partages_masques_commune ON partages_masques (commune_id);

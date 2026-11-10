-- db/migrations/102_publications_associations.sql
-- 2026-11-10, validé par Léandre : espace des associations (lot 2).
-- Un responsable actif d'une association (migration 101) — ou la mairie pour son compte —
-- publie une actualité (avec sondage possible) ou un événement AU NOM de l'association.
-- Ces publications suivent la règle de modération n°4 : un signalement masque immédiatement,
-- la mairie revoit (rétablir ou supprimer). Les événements d'association sont partagés dans
-- « Autour de moi » comme ceux de la mairie (decouverte.ts). Offre payante uniquement : la
-- publication exige l'onglet Annuaire actif (worker/src/lib/associations.ts).

-- Rattachement à l'association. ON DELETE CASCADE : une fiche supprimée par la mairie emporte
-- ses publications (sinon elles s'afficheraient comme des publications de la mairie). Les
-- fichiers R2 associés sont effacés par la route de suppression de fiche (annuaire.ts).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS fiche_id UUID REFERENCES annuaire(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS fiche_id UUID REFERENCES annuaire(id) ON DELETE CASCADE;

-- Masquage après signalement (même vocabulaire que posts / photos_du_jour : visible | masquee).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'visible'
  CHECK (statut IN ('visible', 'masquee'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'visible'
  CHECK (statut IN ('visible', 'masquee'));

CREATE INDEX IF NOT EXISTS idx_articles_fiche ON articles (commune_id, fiche_id) WHERE fiche_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_fiche ON events (commune_id, fiche_id) WHERE fiche_id IS NOT NULL;

-- Signalements d'actualités d'association et d'événements non officiels : un par habitant et par
-- publication (UNIQUE), exactement une cible par ligne (CHECK).
CREATE TABLE IF NOT EXISTS publications_signalements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((article_id IS NULL) <> (event_id IS NULL)),
  UNIQUE (article_id, user_id),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_publications_signalements_commune ON publications_signalements (commune_id);

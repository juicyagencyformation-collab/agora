-- db/migrations/104_badges_parcours.sql
-- 2026-11-15, validé par Léandre (maquette https://claude.ai/artifact/Q1o4t5afc1cgrdR8PGRRu2) :
-- badges de parcours. La mairie peut offrir un badge à ceux qui terminent une chasse ou une
-- balade (nom, icône, métal, petite phrase) ; il rejoint la collection du profil.
-- Logique : worker/src/lib/badges-parcours.ts. Tests : worker/test/badges-parcours.test.ts.

-- 1. Réglage du badge sur le parcours. Tout à NULL = pas de badge (cas de tous les parcours
--    existants). badge_nom renseigné = badge offert ; les trois autres l'accompagnent.
ALTER TABLE chasses_tresor ADD COLUMN IF NOT EXISTS badge_nom TEXT;
ALTER TABLE chasses_tresor ADD COLUMN IF NOT EXISTS badge_icone TEXT;
ALTER TABLE chasses_tresor ADD COLUMN IF NOT EXISTS badge_metal TEXT;
ALTER TABLE chasses_tresor ADD COLUMN IF NOT EXISTS badge_phrase TEXT;

-- 2. Badges gagnés. Le badge est COPIÉ à l'obtention (nom, icône, métal, phrase, village,
--    titre du parcours) : il reste intact si la mairie modifie ou archive le parcours ensuite.
--    commune_id = commune du COMPTE du joueur (isolation tenant, comme badges_obtenus) ;
--    commune_parcours_id = commune où se trouve le parcours (différente pour les jeux joués
--    ailleurs et pour l'espace Explorateurs).
--    type 'parcours' = badge d'un parcours ; 'village' = grand badge du village, gagné
--    automatiquement en terminant tous les parcours publiés d'une commune (au moins 2).
--    rang = « 12ᵉ personne à l'obtenir », figé à l'obtention.
--    niveau / ameliore_le (grand badge uniquement) : le badge monte d'un niveau (★, ★★…) chaque
--    fois que la personne termine de nouveau TOUS les parcours publiés, après que la mairie en a
--    ajouté (validé par Léandre le 2026-11-15). Toujours 1 pour un badge de parcours.
CREATE TABLE IF NOT EXISTS badges_parcours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commune_parcours_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'parcours' CHECK (type IN ('parcours', 'village')),
  chasse_id UUID REFERENCES chasses_tresor(id) ON DELETE SET NULL,
  nom TEXT NOT NULL,
  icone TEXT NOT NULL,
  metal TEXT NOT NULL,
  phrase TEXT,
  village_nom TEXT NOT NULL,
  parcours_titre TEXT,
  rang INTEGER NOT NULL DEFAULT 1,
  niveau INTEGER NOT NULL DEFAULT 1,
  ameliore_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, chasse_id)
);

-- Base où une première version de cette migration (sans niveau) a déjà été passée le
-- 2026-11-15 : CREATE TABLE IF NOT EXISTS ci-dessus ne fait alors rien, ces deux lignes ajoutent
-- les colonnes manquantes. Sans effet sur une base neuve.
ALTER TABLE badges_parcours ADD COLUMN IF NOT EXISTS niveau INTEGER NOT NULL DEFAULT 1;
ALTER TABLE badges_parcours ADD COLUMN IF NOT EXISTS ameliore_le TIMESTAMPTZ;

-- Un seul grand badge par personne et par village (anti-farming, règle n°6).
CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_parcours_village_unique
  ON badges_parcours (user_id, commune_parcours_id) WHERE type = 'village';
CREATE INDEX IF NOT EXISTS idx_badges_parcours_user
  ON badges_parcours (commune_id, user_id);
CREATE INDEX IF NOT EXISTS idx_badges_parcours_chasse
  ON badges_parcours (chasse_id);

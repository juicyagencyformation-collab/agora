-- db/migrations/002_articles_onglets.sql
CREATE TABLE onglets_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  cle TEXT NOT NULL,
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(commune_id, cle)
);

CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  auteur_id UUID NOT NULL REFERENCES users(id),
  section TEXT NOT NULL DEFAULT 'actualites',
  titre TEXT NOT NULL,
  contenu_html TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_articles_commune ON articles(commune_id, section, created_at DESC);

CREATE TABLE article_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  url TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_article_images_article ON article_images(article_id);

CREATE TABLE article_sondages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  multi_choix BOOLEAN NOT NULL DEFAULT false,
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE article_sondage_choix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  sondage_id UUID NOT NULL REFERENCES article_sondages(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE article_sondage_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  sondage_id UUID NOT NULL REFERENCES article_sondages(id) ON DELETE CASCADE,
  choix_id UUID NOT NULL REFERENCES article_sondage_choix(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sondage_id, choix_id, user_id)
);

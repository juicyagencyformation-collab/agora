-- db/migrations/116_reactions_coups_de_main.sql
-- 2026-11-22, demandé par Léandre : réactions emoji « façon Discord » sur les annonces d'Entraide.
-- Palette fixe d'emojis bienveillants (liste blanche dans worker/src/routes/coups_de_main.ts,
-- validée par Zod) : pas de texte libre, donc rien à modérer. Plusieurs emojis différents
-- possibles par personne, mais chacun une seule fois (UNIQUE). Aucune XP attribuée : rien à farmer.
CREATE TABLE IF NOT EXISTS coups_de_main_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  annonce_id UUID NOT NULL REFERENCES coups_de_main(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(annonce_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_coups_de_main_reactions_annonce ON coups_de_main_reactions (annonce_id);

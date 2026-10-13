-- db/migrations/081_coups_de_main_ameliorations.sql
-- Trois ameliorations decidees avec Leandre le 2026-10-13 :
-- 1. Statut "pourvu" : une annonce resolue reste visible (preuve sociale que l'entraide
--    fonctionne) mais demotee visuellement cote client, plutot que de disparaitre.
-- 2. Contact en app : au lieu d'exposer un numero en clair a toute la commune via le champ
--    "contact" existant (laisse tel quel, toujours optionnel), un citoyen peut exprimer son
--    interet avec un message prive, visible seulement par l'auteur de l'annonce.
-- 3. Photo optionnelle, une seule (comme conseil_membres.photo_url/annuaire.logo_url -
--    colonnes directes, pas de table jointe, inutile pour une seule image).
ALTER TABLE coups_de_main ADD COLUMN IF NOT EXISTS pourvu BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE coups_de_main ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE coups_de_main ADD COLUMN IF NOT EXISTS photo_r2_key TEXT;

-- UNIQUE(annonce_id, user_id) : une seule expression d'interet par personne et par annonce,
-- pour ne pas spammer l'auteur de notifications si quelqu'un re-clique plusieurs fois.
CREATE TABLE IF NOT EXISTS coups_de_main_interets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id) ON DELETE CASCADE,
  annonce_id UUID NOT NULL REFERENCES coups_de_main(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(annonce_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_coups_de_main_interets_annonce ON coups_de_main_interets (annonce_id);

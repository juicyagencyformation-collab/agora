-- db/migrations/061_prospects_perdu.sql
-- Pipeline de relance des prospects refusés ("perdu") — demandé par Léandre le 2026-09-03 : un
-- refus disparaissait purement et simplement du suivi (statut perdu exclu du tableau de bord
-- Aujourd'hui et des relances en lot). perdu_le + raison_perdu séparés de notes/prochaine_relance_le
-- pour rester lisibles dans un tableau dédié (nom / date du refus / raison / relance prévue).
-- Posés automatiquement par le Worker au moment du passage en statut "perdu" (voir PATCH
-- /prospection/prospects/:id) — jamais saisis à la main pour rester systématiques.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS perdu_le DATE;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS raison_perdu TEXT;

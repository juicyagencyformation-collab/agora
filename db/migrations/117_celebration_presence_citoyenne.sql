-- db/migrations/117_celebration_presence_citoyenne.sql
-- 2026-11-22, demandé par Léandre : quand l'organisateur valide une présence citoyenne, le
-- participant voit un « +N » animé à l'écran (une seule fois), en plus d'une notification.
-- NULL = pas encore célébrée. Logique : worker/src/routes/agenda.ts (GET /mes-confirmations,
-- POST /mes-confirmations/vues) ; affichage : frontend/js/participation-citoyenne.js.
-- Table déjà rattachée à commune_id (une ligne par participant et par événement).
ALTER TABLE participations_citoyennes ADD COLUMN IF NOT EXISTS celebration_vue_le TIMESTAMPTZ;

-- Les anciennes validations ne sont pas rejouées, sauf celles des 3 derniers jours (dont les deux
-- présences validées le 2026-11-21, que leurs participants n'ont jamais vues confirmées).
UPDATE participations_citoyennes SET celebration_vue_le = now()
WHERE statut = 'confirme' AND celebration_vue_le IS NULL
  AND (valide_le IS NULL OR valide_le < now() - interval '3 days');

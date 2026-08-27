-- db/migrations/054_prospects_etoiles.sql
-- Favoris avec classement par étoiles (1-5), demandé par Léandre le 2026-08-27 : retrouver
-- rapidement les prospects prioritaires depuis le panneau de gauche du backoffice sans repasser
-- par la liste/recherche complète. 0 = pas favori ; 1-5 = favori, classé par nombre d'étoiles.
-- Plage validée côté Worker (Zod, comme le reste des enums de ce projet), pas de CHECK ici —
-- même convention que statut sur cette table.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS etoiles SMALLINT NOT NULL DEFAULT 0;

-- db/migrations/099_communes_etoiles.sql
-- Favoris (étoiles 1-5) posables sur une commune cliente qui n'a pas de fiche prospect (demandé par
-- Léandre le 2026-11-05) : sa vraie commune « eaucourt », créée avant la prospection, ne pouvait
-- pas être mise en favori, les étoiles n'existant que sur la table prospects (migration 054).
-- Champ interne au backoffice : l'application des habitants ne le lit jamais. 0 = pas favori.
-- Une commune qui a une fiche prospect garde ses étoiles côté prospect (pas de double emploi).
ALTER TABLE communes ADD COLUMN IF NOT EXISTS etoiles SMALLINT NOT NULL DEFAULT 0;

-- Vérification : doit renvoyer 0 (aucune commune en favori pour l'instant).
SELECT count(*) AS communes_en_favori FROM communes WHERE etoiles > 0;

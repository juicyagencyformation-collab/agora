-- db/migrations/025_communes_forfait.sql
-- Forfait & quota de stockage par commune (backoffice). Simple : un nom de forfait libre et un
-- quota en Go. NULL = non défini / illimité. La consommation réelle est calculée à la volée
-- depuis R2 (préfixe `${commune_id}/`), on ne stocke donc que la limite ici.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS forfait TEXT;
ALTER TABLE communes ADD COLUMN IF NOT EXISTS quota_go NUMERIC;

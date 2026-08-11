-- db/migrations/020_chasse_mode_balade.sql
-- Mode d'une chasse : 'chasse' (QR à scanner sur place, historique) ou 'balade' (balade
-- guidée sur le terrain — carte + itinéraire, validation par proximité GPS, sans QR).
-- rayon_metres : distance max au point pour valider une étape en mode balade.
ALTER TABLE chasses_tresor ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'chasse';
ALTER TABLE chasses_tresor ADD COLUMN IF NOT EXISTS rayon_metres INTEGER NOT NULL DEFAULT 50;

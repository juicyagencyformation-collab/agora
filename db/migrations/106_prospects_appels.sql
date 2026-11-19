-- db/migrations/106_prospects_appels.sql
-- Prospection par téléphone (2026-11-19) : horaires d'ouverture de la mairie (annuaire
-- service-public, champ plage_ouverture) pour appeler pendant les permanences, et heure de
-- rappel convenue au téléphone (« rappelez-moi jeudi après 14 h »).
-- Table prospects : périmètre staff transverse (pas de commune_id tenant, cf. migration 024).

-- Horaires normalisés par jour ISO (1 = lundi … 7 = dimanche) :
-- {"1": [["08:30","12:00"],["13:30","18:00"]], "5": [["08:30","12:00"]]}
-- NULL + horaires_verifies_le renseigné = l'annuaire ne publie pas d'horaires pour cette mairie.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS horaires_ouverture JSONB;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS horaires_verifies_le TIMESTAMPTZ;

-- Heure du rappel convenu (facultative) : complète prochaine_relance_le, effacée dès que la
-- date de relance change par un autre chemin (email +7 jours, date modifiée à la main…).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS prochaine_relance_heure TIME;

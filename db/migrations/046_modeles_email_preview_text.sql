-- db/migrations/046_modeles_email_preview_text.sql
-- Enrichit modeles_email (variantes A/B de l'email de présentation, migration 037) plutôt que
-- de créer un système de templates parallèle :
--   - preview_text : texte d'aperçu (preheader) affiché par Gmail/Outlook sous l'objet. Saisi
--     SANS le bloc caché ni l'espaceur anti-logo — ces deux blocs sont injectés à la volée au
--     rendu final (voir injecterPreviewText dans email-commune.ts), jamais stockés en base, pour
--     ne jamais avoir à les taper à la main ni les dupliquer si le texte change.
--   - angle_teste : champ libre pour se repérer entre variantes (ex. "douleur", "curiosité") —
--     purement descriptif, aucune logique dessus.
ALTER TABLE modeles_email ADD COLUMN IF NOT EXISTS preview_text TEXT;
ALTER TABLE modeles_email ADD COLUMN IF NOT EXISTS angle_teste TEXT;

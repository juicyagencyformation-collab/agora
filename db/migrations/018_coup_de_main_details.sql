-- db/migrations/018_coup_de_main_details.sql
-- Détails optionnels sur une annonce d'entraide : contact (tél/email), prix, disponibilités.
ALTER TABLE coups_de_main ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE coups_de_main ADD COLUMN IF NOT EXISTS prix TEXT;
ALTER TABLE coups_de_main ADD COLUMN IF NOT EXISTS disponibilites TEXT;

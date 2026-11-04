-- db/migrations/097_signature_conventions.sql
-- 2026-11-04 : signature électronique simple (eIDAS) des conventions par le Prestataire, depuis le
-- backoffice (bouton « Signer et figer », voir worker/src/backoffice/conventions.ts). Le document
-- signé (convention + DPA en annexe 1) est figé tel quel : instantané HTML, empreinte SHA-256, date
-- et auteur. Tant qu'il est figé, la convention n'est plus modifiable (ni par le staff, ni par le
-- formulaire de la mairie) ; « Annuler ma signature » le libère tant que la mairie n'a pas signé.
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS document_signe_html TEXT;
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS signature_prestataire_le TIMESTAMPTZ;
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS signature_prestataire_par UUID REFERENCES staff_backoffice(id) ON DELETE SET NULL;
ALTER TABLE conventions ADD COLUMN IF NOT EXISTS signature_prestataire_empreinte TEXT;

-- db/migrations/114_devis_abonnement.sql
-- 2026-11-20, demandé par Léandre (« le plus simple possible ») : un devis créé depuis le bloc
-- « 💶 Abonnement » de la fiche commune retient la formule et le statut de commune fondatrice,
-- pour que « Activer et facturer » (POST /administration/communes/:id/activer-abonnement)
-- applique exactement ce que la mairie a commandé, sans rien ressaisir.
-- Devis libres ou créés à la main : formule NULL, fondatrice false (rien ne change pour eux).
ALTER TABLE devis ADD COLUMN IF NOT EXISTS formule TEXT CHECK (formule IN ('autonomie', 'accompagne'));
ALTER TABLE devis ADD COLUMN IF NOT EXISTS fondatrice BOOLEAN NOT NULL DEFAULT false;

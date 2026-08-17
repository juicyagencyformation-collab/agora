-- db/migrations/041_envois_prospection_test.sql
-- Distingue les envois de test (bouton "Tester la présentation" du diagnostic email) des vrais
-- envois de prospection, pour ne pas polluer l'entonnoir par variante (GET /prospection/stats-variantes).
ALTER TABLE envois_prospection ADD COLUMN IF NOT EXISTS est_test BOOLEAN NOT NULL DEFAULT false;

-- db/migrations/093_taches_suivi.sql
-- Étape 3 du remaniement du backoffice (2026-11-04) : liste de tâches de la page « Aujourd'hui ».
-- Les tâches elles-mêmes ne sont PAS stockées : elles sont recalculées à chaque ouverture à partir
-- de la prochaine action de chaque commune (backoffice/suivi-communes.ts), donc jamais en retard
-- sur la réalité, et une tâche réglée disparaît d'elle-même. Cette table ne retient que ce que le
-- staff a décidé sur une tâche : masquée jusqu'à une date (« Fait » ou « Reporter ») et à qui elle
-- est confiée. Clé = identifiant stable de la tâche (ex. « commune:<id>:formule »).
CREATE TABLE IF NOT EXISTS taches_suivi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cle TEXT NOT NULL UNIQUE,
  commune_id UUID REFERENCES communes(id) ON DELETE CASCADE,
  masquee_jusqu_au DATE,
  derniere_action TEXT CHECK (derniere_action IN ('faite', 'reportee')),
  assignee_staff_id UUID REFERENCES staff_backoffice(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

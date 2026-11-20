-- db/migrations/113_etat_quota_resend.sql
-- 2026-11-20, demandé par Léandre : suivre presque en direct la consommation du quota Resend
-- (plan gratuit : 100 emails/jour, 3 000/mois ; les emails REÇUS comptent aussi). Resend renvoie
-- la consommation dans les en-têtes x-resend-daily-quota / x-resend-monthly-quota de ses réponses :
-- lib/email.ts en garde la dernière valeur ici (au plus une écriture par minute, ou à chaque refus
-- pour quota atteint), et la page « Aujourd'hui » du backoffice la relit, en interrogeant aussi
-- Resend directement. Une seule ligne (id = 1), table de plateforme : pas de commune_id.
-- Logique : worker/src/lib/email.ts, worker/src/backoffice/quota-resend.ts.
CREATE TABLE IF NOT EXISTS etat_resend (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  quota_jour INTEGER,
  quota_mois INTEGER,
  -- Dernier refus de Resend pour quota (daily_quota_exceeded / monthly_quota_exceeded) et sa date.
  dernier_refus TEXT,
  dernier_refus_le TIMESTAMPTZ,
  maj_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

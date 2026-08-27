-- db/migrations/053_emails_recus_message_id.sql
-- Message-ID RFC de l'email reçu (voir CLAUDE.md pratique : payload webhook Resend
-- email.received, champ data.message_id), pour pouvoir répondre en threadant correctement
-- (en-têtes In-Reply-To/References) — sans ça, une réponse envoyée depuis le backoffice
-- arriverait comme un email tout neuf plutôt que comme une réponse dans la même conversation.
-- Voir worker/src/backoffice/emails-recus.ts et POST /prospection/emails-recus/:id/repondre.
ALTER TABLE emails_recus ADD COLUMN IF NOT EXISTS message_id_original TEXT;

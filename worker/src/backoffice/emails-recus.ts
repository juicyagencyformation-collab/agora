// worker/src/backoffice/emails-recus.ts
// Boîte de réception des réponses reçues des mairies suite à un email de prospection (Resend
// Receiving, événement email.received côté POST /webhook-resend dans index.ts). Volontairement
// SANS IA (décidé avec Léandre le 2026-08-20, après une première version à base de modèle de
// langage jugée trop complexe pour le besoin réel) : un simple tri par mots-clés classe le
// message pour l'afficher au bon endroit dans le backoffice — aucune action automatique n'est
// jamais prise sur le prospect, c'est toujours Léandre qui corrige l'email ou reprogramme la
// relance à la main (voir la fiche prospect : champ email éditable, bouton « Mairie fermée »).
import { supabaseSelect, supabaseInsert } from '../db';

export type CategorieEmailRecu = 'fermeture' | 'changement_email' | 'autre';

// "Nom Prénom <email@domaine.fr>" ou simplement "email@domaine.fr" → extrait juste l'adresse.
export function extraireAdresse(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const m = brut.match(/<([^>]+)>/);
  const candidat = (m ? m[1] : brut).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidat) ? candidat : null;
}

function depuisHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Le webhook ne porte que l'email_id : il faut rappeler l'API Resend pour avoir le texte.
async function recupererCorpsEmail(env: any, emailId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    if (!res.ok) return null;
    const donnees = await res.json() as any;
    return (donnees.text as string) || depuisHtml(donnees.html) || '';
  } catch {
    return null;
  }
}

// Tri par mots-clés, volontairement simple : sert juste à trier l'affichage dans le backoffice,
// jamais à décider d'une action automatique — une mauvaise classification n'a donc aucune
// conséquence sur les données (contrairement à une extraction IA qui agirait à la place de
// Léandre). "changement_email" est vérifié en premier : un message peut mentionner une fermeture
// ET donner une nouvelle adresse, le changement d'adresse est l'info la plus actionnable des deux.
const MOTS_CHANGEMENT_EMAIL = [
  /adresse .*(a chang|n'est plus|n'a plus|obsolète|invalide)/i,
  /(nouvelle adresse|merci d'utiliser|veuillez utiliser|désormais à|contactez plutôt|à l'adresse suivante)/i,
  /(this address|no longer|has changed|please use)/i,
];
const MOTS_FERMETURE = [
  /(ferm(é|ée|eture)|absen(t|ce)|congés?|vacances|exceptionnellement clos)/i,
  /(de retour le|réouverture|reprise (le|des activités))/i,
  /(out of office|away from|back on)/i,
];

export function classifierParMotsCles(texte: string): CategorieEmailRecu {
  if (MOTS_CHANGEMENT_EMAIL.some((r) => r.test(texte))) return 'changement_email';
  if (MOTS_FERMETURE.some((r) => r.test(texte))) return 'fermeture';
  return 'autre';
}

// Point d'entrée depuis le webhook : retrouve le prospect concerné (par l'adresse expéditrice,
// celle à laquelle on avait écrit), récupère le corps, le classe, et l'enregistre dans la boîte
// de réception. Idempotent via event_id (svix-id) : un webhook rejoué par Resend ne duplique pas
// la ligne (contrainte UNIQUE, voir migration 049).
export async function traiterEmailRecu(
  env: any, eventId: string, emailId: string, fromMeta: string, sujet: string | null,
): Promise<void> {
  const emailExpediteur = extraireAdresse(fromMeta);
  if (!emailExpediteur) return;

  const existant = await supabaseSelect(env, 'emails_recus', { select: 'id', event_id: `eq.${eventId}` });
  if (existant.length) return;

  const [prospect] = await supabaseSelect(env, 'prospects', { select: 'id,nom', contact_email: `eq.${emailExpediteur}` });

  const texte = await recupererCorpsEmail(env, emailId);
  if (texte === null) return; // échec de récupération : on retentera au prochain envoi

  await supabaseInsert(env, 'emails_recus', {
    event_id: eventId,
    prospect_id: prospect?.id || null,
    commune_nom: prospect?.nom || null,
    expediteur: emailExpediteur,
    sujet: sujet || null,
    texte: texte.slice(0, 5000),
    categorie: classifierParMotsCles(texte),
  });
}

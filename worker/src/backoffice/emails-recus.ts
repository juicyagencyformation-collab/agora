// worker/src/backoffice/emails-recus.ts
// Boîte de réception des réponses reçues des mairies suite à un email de prospection (Resend
// Receiving, événement email.received côté POST /webhook-resend dans index.ts). Volontairement
// SANS IA (décidé avec Léandre le 2026-08-20, après une première version à base de modèle de
// langage jugée trop complexe pour le besoin réel) : un simple tri par mots-clés classe le
// message pour l'afficher au bon endroit dans le backoffice — aucune action automatique n'est
// jamais prise sur le prospect, c'est toujours Léandre qui corrige l'email ou reprogramme la
// relance à la main (voir la fiche prospect : champ email éditable, bouton « Mairie fermée »).
import { supabaseSelect, supabaseSelectTout, supabaseInsert } from '../db';

export type CategorieEmailRecu = 'verification_antispam' | 'fermeture' | 'changement_email' | 'autre';

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
    if (!res.ok) {
      console.error(`GET /emails/receiving/${emailId} (Resend) → ${res.status} : ${await res.text().catch(() => '')}`);
      return null;
    }
    const donnees = await res.json() as any;
    return (donnees.text as string) || depuisHtml(donnees.html) || '';
  } catch (err) {
    console.error(`GET /emails/receiving/${emailId} (Resend) a levé une exception :`, err);
    return null;
  }
}

// Tri par mots-clés, volontairement simple : sert juste à trier l'affichage dans le backoffice,
// jamais à décider d'une action automatique — une mauvaise classification n'a donc aucune
// conséquence sur les données (contrairement à une extraction IA qui agirait à la place de
// Léandre). "verification_antispam" est vérifié EN PREMIER, avant tout le reste : ces messages ne
// sont pas des réponses de mairie mais des accusés de blocage d'un filtre anti-spam d'entreprise
// (Mailinblack notamment, très répandu dans les mairies) — la vraie présentation n'a même pas
// encore été délivrée tant que Léandre n'a pas cliqué le lien de déblocage qu'ils contiennent.
// Signature très reconnaissable (domaine expéditeur dédié + texte fixe), donc aucun risque de
// confusion avec une vraie réponse mentionnant fermeture/changement d'adresse. "changement_email"
// est vérifié ensuite en priorité sur "fermeture" : un message peut mentionner une fermeture ET
// donner une nouvelle adresse, le changement d'adresse est l'info la plus actionnable des deux.
const MOTS_VERIFICATION_ANTISPAM = [
  /mailinblack/i,
  /(confirmer qu['’]il est bien humain|d[ée]livrer votre email|un clic pour d[ée]livrer)/i,
  /(challenge.response|verify (that )?you['’]re human|no-robot)/i,
];
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
  if (MOTS_VERIFICATION_ANTISPAM.some((r) => r.test(texte))) return 'verification_antispam';
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
  messageId: string | null = null,
): Promise<void> {
  const emailExpediteur = extraireAdresse(fromMeta);
  if (!emailExpediteur) {
    console.error(`traiterEmailRecu : adresse expéditrice illisible dans "from" (${fromMeta}), email ${emailId} ignoré`);
    return;
  }

  const existant = await supabaseSelect(env, 'emails_recus', { select: 'id', event_id: `eq.${eventId}` });
  if (existant.length) return; // déjà enregistré (webhook rejoué par Resend) : pas une erreur

  const [prospect] = await supabaseSelect(env, 'prospects', { select: 'id,nom', contact_email: `eq.${emailExpediteur}` });

  const texte = await recupererCorpsEmail(env, emailId);
  if (texte === null) {
    // Échec de récupération du corps auprès de l'API Resend — cause fréquente : RESEND_API_KEY
    // absente/invalide, ou une clé restreinte au seul envoi (sans le scope de lecture "receiving").
    console.error(`traiterEmailRecu : échec de récupération du corps pour l'email ${emailId} auprès de l'API Resend (voir RESEND_API_KEY)`);
    return;
  }

  await supabaseInsert(env, 'emails_recus', {
    event_id: eventId,
    prospect_id: prospect?.id || null,
    commune_nom: prospect?.nom || null,
    expediteur: emailExpediteur,
    sujet: sujet || null,
    texte: texte.slice(0, 5000),
    categorie: classifierParMotsCles(texte),
    message_id_original: messageId || null,
  });
}

// Synchronise emails_recus avec la liste faisant AUTORITÉ de Resend (GET /emails/receiving), qui
// garde une copie de tout ce qui est reçu même quand le webhook ne se déclenche jamais — constaté
// le 2026-08-27 : les réponses automatiques d'absence ("congés") de certaines mairies n'arrivaient
// jamais dans le backoffice, très probablement filtrées par Resend en amont du webhook (motif
// documenté ailleurs dans l'industrie de l'email entrant : suppression des réponses auto-générées
// pour éviter les boucles). Comble donc les trous en repartant de cette liste plutôt que de ne
// compter QUE sur le temps réel — exécuté chaque nuit (cron, voir cron.ts) ET à la demande depuis
// le backoffice (bouton "Synchroniser avec Resend").
// Limite connue : les lignes enregistrées AVANT l'ajout de message_id_original (migration 053) ne
// peuvent pas être reconnues comme déjà vues par ce mécanisme (elles ont ce champ à NULL) — un
// doublon reste possible pour cette poignée de lignes historiques si Resend les a encore dans sa
// fenêtre de résultats. Sans conséquence grave (juste une ligne à marquer traitée deux fois) : pas
// de correctif dédié pour ce cas ponctuel et transitoire.
export async function synchroniserEmailsRecus(env: any): Promise<{ verifies: number; ajoutes: number; erreurs: number }> {
  if (!env.RESEND_API_KEY) return { verifies: 0, ajoutes: 0, erreurs: 0 };

  const dejaEnregistres = new Set(
    (await supabaseSelectTout(env, 'emails_recus', { select: 'message_id_original' }))
      .map((l: any) => l.message_id_original)
      .filter(Boolean),
  );

  let verifies = 0, ajoutes = 0, erreurs = 0;
  let after: string | undefined;
  for (let page = 0; page < 5; page++) { // 5×100 = 500 derniers emails reçus, large marge
    const url = new URL('https://api.resend.com/emails/receiving');
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!res.ok) {
      console.error(`synchroniserEmailsRecus : GET /emails/receiving (liste) → ${res.status}`);
      break;
    }
    const donnees = await res.json() as any;
    const lignes: any[] = donnees.data || [];
    verifies += lignes.length;

    for (const e of lignes) {
      if (!e.message_id || dejaEnregistres.has(e.message_id)) continue;
      try {
        await traiterEmailRecu(env, `sync-${e.id}`, e.id, e.from, e.subject || null, e.message_id);
        dejaEnregistres.add(e.message_id);
        ajoutes += 1;
      } catch (err) {
        console.error(`synchroniserEmailsRecus : échec pour l'email Resend ${e.id} :`, err);
        erreurs += 1;
      }
    }

    if (!donnees.has_more || !lignes.length) break;
    after = lignes[lignes.length - 1].id;
  }
  return { verifies, ajoutes, erreurs };
}

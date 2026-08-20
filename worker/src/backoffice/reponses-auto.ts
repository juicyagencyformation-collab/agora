// worker/src/backoffice/reponses-auto.ts
// Interprétation automatique des réponses reçues des mairies suite à un email de prospection —
// fermeture/absence (vacances, congés, fermeture exceptionnelle) et changement d'adresse email.
// Déclenché depuis POST /webhook-resend (voir index.ts) sur l'événement email.received.
//
// Le webhook Resend lui-même ne contient QUE les métadonnées (from/to/subject/email_id), jamais
// le corps du message — il faut rappeler l'API Resend pour le récupérer (voir
// récupérerCorpsEmail). Le texte de ces réponses varie trop d'une mairie à l'autre pour une
// détection fiable par mots-clés/regex (décision prise avec Léandre le 2026-08-20, après avoir
// pesé l'alternative gratuite mais fragile) : on passe donc le texte à un modèle de langage
// (Claude Haiku, rapide et peu coûteux pour une simple extraction) qui répond en JSON strict.
// Principe de sécurité central : en cas de doute (parsing échoué, catégorie "autre", champ
// manquant), on se contente de journaliser pour relecture humaine — on n'agit JAMAIS sur une
// extraction incertaine (ex: ne jamais écraser un email valide par une déduction hasardeuse).
import { supabaseSelect, supabaseUpdate, supabaseInsert } from '../db';

export type InterpretationReponse = {
  categorie: 'fermeture' | 'changement_email' | 'autre';
  date_retour: string | null;
  nouvel_email: string | null;
  resume: string;
};

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

// Le webhook ne porte que l'email_id : il faut rappeler l'API pour avoir le texte du message.
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

const PROMPT = `Tu analyses un email de réponse automatique reçu par une petite mairie française, en
réponse à un email de présentation commerciale. Réponds UNIQUEMENT avec un objet JSON strict
(aucun texte autour, aucun bloc markdown), exactement au format :
{"categorie":"fermeture"|"changement_email"|"autre","date_retour":"AAAA-MM-JJ"|null,"nouvel_email":"..."|null,"resume":"..."}

Règles :
- "fermeture" : la mairie est fermée, absente, en congés, en vacances, exceptionnellement
  fermée. Si une date de retour/réouverture est indiquée, mets-la dans "date_retour" (sinon null).
- "changement_email" : le message indique que cette adresse a changé/n'est plus utilisée et
  donne une NOUVELLE adresse email à utiliser à la place. Mets-la dans "nouvel_email" (sinon null).
- "autre" : tout le reste (vérification anti-robot, accusé de réception générique, message sans
  rapport, absence d'information exploitable). Dans ce cas date_retour et nouvel_email = null.
- "resume" : une phrase courte en français résumant le message pour un humain.
Ne déduis JAMAIS une date ou un email si le texte ne le donne pas explicitement — en cas de doute,
réponds "autre".

Email reçu :
"""
{{TEXTE}}
"""`;

export async function interpreterReponseAuto(env: any, texte: string): Promise<InterpretationReponse | null> {
  if (!env.ANTHROPIC_API_KEY || !texte.trim()) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: PROMPT.replace('{{TEXTE}}', texte.slice(0, 4000)) }],
      }),
    });
    if (!res.ok) { console.error('interpreterReponseAuto : API Anthropic en erreur :', await res.text()); return null; }
    const donnees = await res.json() as any;
    const brut = donnees?.content?.[0]?.text || '';
    // Filet de sécurité si le modèle encadre malgré tout sa réponse d'un bloc ```json.
    const nettoye = brut.replace(/^```json\s*|```\s*$/g, '').trim();
    const parsed = JSON.parse(nettoye);
    if (!['fermeture', 'changement_email', 'autre'].includes(parsed.categorie)) return null;
    return {
      categorie: parsed.categorie,
      date_retour: typeof parsed.date_retour === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date_retour) ? parsed.date_retour : null,
      nouvel_email: extraireAdresse(parsed.nouvel_email),
      resume: typeof parsed.resume === 'string' ? parsed.resume.slice(0, 300) : '',
    };
  } catch (err) {
    console.error('interpreterReponseAuto a échoué :', err);
    return null;
  }
}

// Applique l'action correspondante et journalise TOUJOURS dans l'historique du prospect — y
// compris quand on n'agit pas, pour qu'une réponse non comprise reste visible pour une relecture
// humaine plutôt que de disparaître silencieusement.
export async function traiterReponseAutoProspect(
  env: any, prospectId: string, interpretation: InterpretationReponse | null, texteBrut: string,
): Promise<void> {
  if (!interpretation || interpretation.categorie === 'autre') {
    await supabaseInsert(env, 'prospect_interactions', {
      prospect_id: prospectId, staff_id: null, type: 'note',
      contenu: interpretation
        ? `Réponse automatique reçue (non actionnable) : ${interpretation.resume}`
        : `Réponse automatique reçue, non interprétée automatiquement : ${texteBrut.slice(0, 500)}`,
    });
    return;
  }

  if (interpretation.categorie === 'fermeture') {
    // Même règle que le bouton manuel "Mairie fermée" de la fiche prospect : sans date connue,
    // on retente dans 14 jours plutôt que de laisser le prospect sans relance programmée.
    const dateRelance = interpretation.date_retour || new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    await supabaseUpdate(env, 'prospects',
      { prochaine_relance_le: dateRelance, updated_at: new Date().toISOString() }, { id: `eq.${prospectId}` });
    await supabaseInsert(env, 'prospect_interactions', {
      prospect_id: prospectId, staff_id: null, type: 'ferme',
      contenu: interpretation.date_retour
        ? `Mairie fermée (détecté automatiquement) — retour prévu le ${interpretation.date_retour}`
        : 'Mairie fermée (détecté automatiquement, date non précisée) — relance reprogrammée dans 14 jours',
    });
    return;
  }

  // categorie === 'changement_email' à partir d'ici.
  if (!interpretation.nouvel_email) {
    // Catégorie détectée mais adresse pas assez fiable pour être extraite (voir extraireAdresse
    // dans interpreterReponseAuto) : on journalise quand même, pour ne jamais faire disparaître
    // silencieusement une réponse reçue — quelqu'un devra corriger l'email à la main.
    await supabaseInsert(env, 'prospect_interactions', {
      prospect_id: prospectId, staff_id: null, type: 'note',
      contenu: `Réponse automatique reçue : changement d'adresse annoncé mais la nouvelle adresse n'a pas pu être extraite avec certitude — à vérifier à la main. Résumé : ${interpretation.resume}`,
    });
    return;
  }
  const [prospect] = await supabaseSelect(env, 'prospects', { select: 'contact_email', id: `eq.${prospectId}` });
  if (prospect && interpretation.nouvel_email !== prospect.contact_email) {
    await supabaseUpdate(env, 'prospects', {
      contact_email: interpretation.nouvel_email, email_invalide: false, updated_at: new Date().toISOString(),
    }, { id: `eq.${prospectId}` });
    await supabaseInsert(env, 'prospect_interactions', {
      prospect_id: prospectId, staff_id: null, type: 'contact',
      contenu: `Email corrigé automatiquement (réponse auto détectée) : ${prospect.contact_email || '(vide)'} → ${interpretation.nouvel_email}`,
    });
  }
}

// Point d'entrée depuis le webhook : retrouve le prospect concerné (par l'adresse expéditrice,
// qui est celle à laquelle on avait écrit), récupère et interprète le message, puis agit. No-op
// silencieux si l'expéditeur ne correspond à aucun prospect suivi (email reçu hors prospection).
export async function traiterEmailRecu(env: any, emailId: string, fromMeta: string): Promise<void> {
  const emailExpediteur = extraireAdresse(fromMeta);
  if (!emailExpediteur) return;

  const [prospect] = await supabaseSelect(env, 'prospects', { select: 'id', contact_email: `eq.${emailExpediteur}` });
  if (!prospect) return;

  const texte = await recupererCorpsEmail(env, emailId);
  if (texte === null) return; // échec de récupération : on retentera au prochain envoi, rien à journaliser

  const interpretation = await interpreterReponseAuto(env, texte);
  await traiterReponseAutoProspect(env, prospect.id, interpretation, texte);
}

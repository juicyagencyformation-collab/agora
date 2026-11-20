// worker/src/lib/double-authentification.ts
// Double authentification des comptes de la mairie (migration 111, validé par Léandre le
// 2026-11-20 ; guide CNIL des collectivités 2026, p. 26). Sans friction au quotidien :
// - mot de passe saisi sur un appareil INCONNU → code à 6 chiffres par email (10 min, 5 essais) ;
// - code bon → l'appareil est reconnu 6 mois (cookie httpOnly propre au compte : un ordinateur
//   de mairie partagé reconnaît chaque compte séparément) ;
// - lien de connexion reçu par email (auth.ts, /lien-connexion) : la boîte mail est déjà le second
//   facteur, pas de code, et l'appareil est reconnu de la même façon.
// Les habitants (citoyen) ne sont jamais concernés. Si l'email du code ne part pas, la connexion
// est refusée avec un message clair (on ne baisse jamais la garde) : un appareil reconnu, lui,
// n'en a pas besoin.
import { getCookie, setCookie } from 'hono/cookie';
import { supabaseSelect, supabaseInsert, supabaseUpdate, supabaseDelete } from '../db';
import { hasherSha256Hex } from './hash';
import { envoyerEmail } from './email';
import { OPTIONS_COOKIE } from './securite';

export const ROLES_DOUBLE_AUTH = ['admin', 'elu', 'maire', 'superadmin'];
const DUREE_APPAREIL_S = 180 * 24 * 3600;
const DUREE_CODE_MS = 10 * 60 * 1000;
const MAX_TENTATIVES = 5;
const MAX_ENVOIS = 3;

const nouveauJeton = () => crypto.randomUUID() + crypto.randomUUID();
export const nomCookieAppareil = (user_id: string) => `agora_ap_${user_id.replace(/-/g, '').slice(0, 12)}`;
const hacherCode = (jeton: string, code: string) => hasherSha256Hex(`${jeton}:${code}`);

// 6 chiffres uniformes (tirage rejeté au-delà du plus grand multiple de 10^6, sans biais).
function genererCode(): string {
  const tampon = new Uint32Array(1);
  do crypto.getRandomValues(tampon); while (tampon[0] >= 4_294_000_000);
  return String(tampon[0] % 1_000_000).padStart(6, '0');
}

export function masquerEmail(email: string): string {
  const [local, domaine] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domaine}`;
}

export async function appareilReconnu(c: any, user_id: string): Promise<boolean> {
  const jeton = getCookie(c, nomCookieAppareil(user_id));
  if (!jeton) return false;
  const [appareil] = await supabaseSelect(c.env, 'appareils_confiance', {
    select: 'id,expires_at', jeton_hash: `eq.${await hasherSha256Hex(jeton)}`, user_id: `eq.${user_id}`,
  });
  return !!appareil && new Date(appareil.expires_at) > new Date();
}

export async function reconnaitreAppareil(c: any, user_id: string, commune_id: string): Promise<void> {
  const jeton = nouveauJeton();
  await supabaseInsert(c.env, 'appareils_confiance', {
    commune_id, user_id, jeton_hash: await hasherSha256Hex(jeton),
    user_agent: (c.req.header('User-Agent') || '').slice(0, 400) || null,
    expires_at: new Date(Date.now() + DUREE_APPAREIL_S * 1000).toISOString(),
  });
  setCookie(c, nomCookieAppareil(user_id), jeton, { ...OPTIONS_COOKIE, maxAge: DUREE_APPAREIL_S });
}

async function envoyerCode(env: any, email: string, prenom: string | null, code: string): Promise<boolean> {
  const id = await envoyerEmail(env, email, `Votre code de connexion Agora : ${code}`, `
    <p>Bonjour${prenom ? ' ' + String(prenom).replace(/[<>&"']/g, '') : ''},</p>
    <p>Voici votre code pour vous connecter à l'administration de votre commune sur Agora :</p>
    <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
    <p>Il est valable 10 minutes. Ce code n'est demandé que sur un nouvel appareil : celui-ci sera ensuite
      reconnu pendant 6 mois.</p>
    <p style="color:#5b6b5c;font-size:13px">Vous n'avez pas essayé de vous connecter ? Quelqu'un connaît peut-être votre mot de passe :
      changez-le depuis « Mot de passe oublié ? » sur la page de connexion.</p>`);
  return !!id;
}

// Mot de passe correct sur un appareil inconnu : prépare la connexion en attente et envoie le code.
// Renvoie le jeton à remettre au navigateur, ou null si l'email n'a pas pu partir.
export async function demarrerDoubleAuthentification(c: any, user: { id: string; email: string; prenom?: string | null }, commune_id: string) {
  const jeton = nouveauJeton();
  const code = genererCode();
  const [ligne] = await supabaseInsert(c.env, 'codes_connexion', {
    commune_id, user_id: user.id, jeton_hash: await hasherSha256Hex(jeton), code_hash: await hacherCode(jeton, code),
    tentatives: 0, envois: 1,
    expires_at: new Date(Date.now() + DUREE_CODE_MS).toISOString(),
  });
  if (!(await envoyerCode(c.env, user.email, user.prenom ?? null, code))) {
    if (ligne?.id) await supabaseDelete(c.env, 'codes_connexion', { id: `eq.${ligne.id}` }).catch(() => {});
    return null;
  }
  return { jeton, email_masque: masquerEmail(user.email) };
}

type Resultat = { ok: true; user_id: string } | { ok: false; erreur: string; statut: 400 | 401 | 410 | 429 | 503 };

async function chargerAttente(c: any, jeton: string, commune_id: string) {
  const [attente] = await supabaseSelect(c.env, 'codes_connexion', {
    select: 'id,user_id,code_hash,tentatives,envois,expires_at,utilise_le',
    jeton_hash: `eq.${await hasherSha256Hex(jeton)}`, commune_id: `eq.${commune_id}`,
  });
  return attente ?? null;
}

const EXPIRE: Resultat = { ok: false, erreur: 'Ce code a expiré. Reconnectez-vous pour en recevoir un nouveau.', statut: 410 };

export async function verifierCodeConnexion(c: any, jeton: string, code: string, commune_id: string): Promise<Resultat> {
  const attente = await chargerAttente(c, jeton, commune_id);
  if (!attente || attente.utilise_le || new Date(attente.expires_at) < new Date() || attente.tentatives >= MAX_TENTATIVES) return EXPIRE;
  if ((await hacherCode(jeton, code)) !== attente.code_hash) {
    const tentatives = attente.tentatives + 1;
    await supabaseUpdate(c.env, 'codes_connexion', { tentatives }, { id: `eq.${attente.id}` });
    return tentatives >= MAX_TENTATIVES
      ? { ok: false, erreur: 'Trop d\'essais. Reconnectez-vous pour recevoir un nouveau code.', statut: 429 }
      : { ok: false, erreur: `Code incorrect (${MAX_TENTATIVES - tentatives} essai${MAX_TENTATIVES - tentatives > 1 ? 's' : ''} restant${MAX_TENTATIVES - tentatives > 1 ? 's' : ''}).`, statut: 401 };
  }
  // Usage unique, même en cas de double envoi simultané (filtre utilise_le IS NULL).
  const reserve = await supabaseUpdate(c.env, 'codes_connexion', { utilise_le: new Date().toISOString() }, { id: `eq.${attente.id}`, utilise_le: 'is.null' });
  if (!reserve.length) return EXPIRE;
  return { ok: true, user_id: attente.user_id };
}

export async function renvoyerCodeConnexion(c: any, jeton: string, commune_id: string): Promise<Resultat> {
  const attente = await chargerAttente(c, jeton, commune_id);
  if (!attente || attente.utilise_le || attente.tentatives >= MAX_TENTATIVES) return EXPIRE;
  if (attente.envois >= MAX_ENVOIS) return { ok: false, erreur: 'Trop d\'envois. Reconnectez-vous dans quelques minutes.', statut: 429 };
  const [user] = await supabaseSelect(c.env, 'users', { select: 'email,prenom', id: `eq.${attente.user_id}` });
  if (!user) return EXPIRE;
  const code = genererCode();
  await supabaseUpdate(c.env, 'codes_connexion', {
    code_hash: await hacherCode(jeton, code), envois: attente.envois + 1, tentatives: 0,
    expires_at: new Date(Date.now() + DUREE_CODE_MS).toISOString(),
  }, { id: `eq.${attente.id}` });
  if (!(await envoyerCode(c.env, user.email, user.prenom, code))) {
    return { ok: false, erreur: 'Le code n\'a pas pu être envoyé. Réessayez dans quelques minutes.', statut: 503 };
  }
  return { ok: true, user_id: attente.user_id };
}

// Purge quotidienne (cron 4 h) : codes de plus d'un jour, appareils expirés.
export async function purgerDoubleAuthentification(env: any): Promise<void> {
  const maintenant = new Date();
  await supabaseDelete(env, 'codes_connexion', { created_at: `lt.${new Date(maintenant.getTime() - 24 * 3600 * 1000).toISOString()}` });
  await supabaseDelete(env, 'appareils_confiance', { expires_at: `lt.${maintenant.toISOString()}` });
}

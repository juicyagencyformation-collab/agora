// worker/src/lib/double-authentification.ts
// Double authentification par code reçu par email, pour deux publics (mêmes règles de code :
// 6 chiffres, 10 min, 5 essais, 3 envois, usage unique, haché avec le jeton remis au navigateur) :
//
// 1. Comptes de la mairie (migration 111, validé par Léandre le 2026-11-20 ; guide CNIL des
//    collectivités 2026, p. 26). Sans friction au quotidien :
//    - mot de passe saisi sur un appareil INCONNU → code par email ;
//    - code bon → l'appareil est reconnu 6 mois (cookie httpOnly propre au compte : un ordinateur
//      de mairie partagé reconnaît chaque compte séparément) ;
//    - lien de connexion reçu par email (auth.ts, /lien-connexion) : la boîte mail est déjà le
//      second facteur, pas de code, et l'appareil est reconnu de la même façon.
//    Les habitants (citoyen) ne sont jamais concernés.
// 2. Staff du backoffice (migration 112, choix de Léandre : « une fois par jour ») : code à la
//    connexion puis au premier passage de chaque journée, valable jusqu'au lendemain 5 h (Paris).
//    Voir backoffice/auth.ts.
//
// Si l'email du code ne part pas, la connexion est refusée avec un message clair : on ne baisse
// jamais la garde.
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

// Prochain 5 h du matin, heure de Paris (heure d'été/hiver gérée par Intl, sans dépendance).
function decalageParisMinutes(date: Date): number {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)) p[x.type] = x.value;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime()) / 60000);
}
function cinqHeuresParis(jour: Date): Date {
  const approx = new Date(`${jour.toISOString().slice(0, 10)}T05:00:00Z`);
  return new Date(approx.getTime() - decalageParisMinutes(approx) * 60000);
}
export function finDuCodeDuJour(maintenant = new Date()): Date {
  const aujourdhui = cinqHeuresParis(maintenant);
  return aujourdhui > maintenant ? aujourdhui : cinqHeuresParis(new Date(maintenant.getTime() + 24 * 3600 * 1000));
}

// ── Mécanique commune aux deux publics ─────────────────────────────────────────────────────
type Resultat = { ok: true; id: string } | { ok: false; erreur: string; statut: 400 | 401 | 410 | 429 | 503 };
type Cible = {
  table: 'codes_connexion' | 'staff_codes_connexion';
  colonne: 'user_id' | 'staff_id';
  filtre: Record<string, string>;   // cloisonnement (commune pour les maires)
  ligne: Record<string, string>;    // colonnes fixes à l'insertion
  destinataire: (id: string) => Promise<{ email: string; prenom?: string | null } | null>;
  email: (code: string, prenom?: string | null) => { sujet: string; html: string };
};
const EXPIRE: Resultat = { ok: false, erreur: 'Ce code a expiré. Reconnectez-vous pour en recevoir un nouveau.', statut: 410 };
const nettoyerPrenom = (p?: string | null) => (p ? ' ' + String(p).replace(/[<>&"']/g, '') : '');

async function envoyerCode(env: any, cible: Cible, email: string, prenom: string | null | undefined, code: string): Promise<boolean> {
  const { sujet, html } = cible.email(code, prenom);
  return !!(await envoyerEmail(env, email, sujet, html));
}

async function demarrer(c: any, cible: Cible, id: string, email: string, prenom?: string | null) {
  const jeton = nouveauJeton();
  const code = genererCode();
  const [ligne] = await supabaseInsert(c.env, cible.table, {
    ...cible.ligne, [cible.colonne]: id, jeton_hash: await hasherSha256Hex(jeton), code_hash: await hacherCode(jeton, code),
    tentatives: 0, envois: 1, expires_at: new Date(Date.now() + DUREE_CODE_MS).toISOString(),
  });
  if (!(await envoyerCode(c.env, cible, email, prenom, code))) {
    if (ligne?.id) await supabaseDelete(c.env, cible.table, { id: `eq.${ligne.id}` }).catch(() => {});
    return null;
  }
  return { jeton, email_masque: masquerEmail(email) };
}

async function chargerAttente(c: any, cible: Cible, jeton: string) {
  const [attente] = await supabaseSelect(c.env, cible.table, {
    select: `id,${cible.colonne},code_hash,tentatives,envois,expires_at,utilise_le`,
    jeton_hash: `eq.${await hasherSha256Hex(jeton)}`, ...cible.filtre,
  });
  return attente ?? null;
}

async function verifier(c: any, cible: Cible, jeton: string, code: string): Promise<Resultat> {
  const attente = await chargerAttente(c, cible, jeton);
  if (!attente || attente.utilise_le || new Date(attente.expires_at) < new Date() || attente.tentatives >= MAX_TENTATIVES) return EXPIRE;
  if ((await hacherCode(jeton, code)) !== attente.code_hash) {
    const tentatives = attente.tentatives + 1;
    const restants = MAX_TENTATIVES - tentatives;
    await supabaseUpdate(c.env, cible.table, { tentatives }, { id: `eq.${attente.id}` });
    return restants <= 0
      ? { ok: false, erreur: 'Trop d\'essais. Reconnectez-vous pour recevoir un nouveau code.', statut: 429 }
      : { ok: false, erreur: `Code incorrect (${restants} essai${restants > 1 ? 's' : ''} restant${restants > 1 ? 's' : ''}).`, statut: 401 };
  }
  // Usage unique, même en cas de double envoi simultané (filtre utilise_le IS NULL).
  const reserve = await supabaseUpdate(c.env, cible.table, { utilise_le: new Date().toISOString() }, { id: `eq.${attente.id}`, utilise_le: 'is.null' });
  if (!reserve.length) return EXPIRE;
  return { ok: true, id: attente[cible.colonne] };
}

async function renvoyer(c: any, cible: Cible, jeton: string): Promise<Resultat> {
  const attente = await chargerAttente(c, cible, jeton);
  if (!attente || attente.utilise_le || attente.tentatives >= MAX_TENTATIVES) return EXPIRE;
  if (attente.envois >= MAX_ENVOIS) return { ok: false, erreur: 'Trop d\'envois. Reconnectez-vous dans quelques minutes.', statut: 429 };
  const destinataire = await cible.destinataire(attente[cible.colonne]);
  if (!destinataire) return EXPIRE;
  const code = genererCode();
  await supabaseUpdate(c.env, cible.table, {
    code_hash: await hacherCode(jeton, code), envois: attente.envois + 1, tentatives: 0,
    expires_at: new Date(Date.now() + DUREE_CODE_MS).toISOString(),
  }, { id: `eq.${attente.id}` });
  if (!(await envoyerCode(c.env, cible, destinataire.email, destinataire.prenom, code))) {
    return { ok: false, erreur: 'Le code n\'a pas pu être envoyé. Réessayez dans quelques minutes.', statut: 503 };
  }
  return { ok: true, id: attente[cible.colonne] };
}

const AVERTISSEMENT = `<p style="color:#5b6b5c;font-size:13px">Vous n'avez pas essayé de vous connecter ? Quelqu'un connaît peut-être
  votre mot de passe : changez-le au plus vite.</p>`;
const blocCode = (code: string) => `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>`;

// ── 1. Comptes de la mairie ────────────────────────────────────────────────────────────────
const cibleMairie = (env: any, commune_id: string): Cible => ({
  table: 'codes_connexion', colonne: 'user_id',
  filtre: { commune_id: `eq.${commune_id}` }, ligne: { commune_id },
  destinataire: async (id) => (await supabaseSelect(env, 'users', { select: 'email,prenom', id: `eq.${id}` }))[0] ?? null,
  email: (code, prenom) => ({
    sujet: `Votre code de connexion Agora : ${code}`,
    html: `<p>Bonjour${nettoyerPrenom(prenom)},</p>
      <p>Voici votre code pour vous connecter à l'administration de votre commune sur Agora :</p>${blocCode(code)}
      <p>Il est valable 10 minutes. Ce code n'est demandé que sur un nouvel appareil : celui-ci sera ensuite reconnu pendant 6 mois.</p>
      ${AVERTISSEMENT.replace('au plus vite', 'depuis « Mot de passe oublié ? » sur la page de connexion')}`,
  }),
});

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

// Mot de passe correct sur un appareil inconnu : prépare la connexion en attente et envoie le code.
// Renvoie le jeton à remettre au navigateur, ou null si l'email n'a pas pu partir.
export function demarrerDoubleAuthentification(c: any, user: { id: string; email: string; prenom?: string | null }, commune_id: string) {
  return demarrer(c, cibleMairie(c.env, commune_id), user.id, user.email, user.prenom);
}
export async function verifierCodeConnexion(c: any, jeton: string, code: string, commune_id: string) {
  const r = await verifier(c, cibleMairie(c.env, commune_id), jeton, code);
  return r.ok ? { ok: true as const, user_id: r.id } : r;
}
export function renvoyerCodeConnexion(c: any, jeton: string, commune_id: string) {
  return renvoyer(c, cibleMairie(c.env, commune_id), jeton);
}

// ── 2. Staff du backoffice ─────────────────────────────────────────────────────────────────
const cibleStaff = (env: any): Cible => ({
  table: 'staff_codes_connexion', colonne: 'staff_id', filtre: {}, ligne: {},
  destinataire: async (id) => {
    const [staff] = await supabaseSelect(env, 'staff_backoffice', { select: 'email,nom', id: `eq.${id}`, actif: 'eq.true' });
    return staff ? { email: staff.email, prenom: staff.nom } : null;
  },
  email: (code, nom) => ({
    sujet: `Code du jour, backoffice Plateforme-Agora : ${code}`,
    html: `<p>Bonjour${nettoyerPrenom(nom)},</p>
      <p>Voici votre code pour ouvrir le backoffice de Plateforme-Agora :</p>${blocCode(code)}
      <p>Il est valable 10 minutes. Une fois saisi, vous n'aurez plus de code à taper jusqu'à demain 5 h.</p>${AVERTISSEMENT}`,
  }),
});

export function demarrerCodeStaff(c: any, staff: { id: string; email: string; nom?: string | null }) {
  return demarrer(c, cibleStaff(c.env), staff.id, staff.email, staff.nom);
}
export async function verifierCodeStaff(c: any, jeton: string, code: string) {
  const r = await verifier(c, cibleStaff(c.env), jeton, code);
  return r.ok ? { ok: true as const, staff_id: r.id } : r;
}
export function renvoyerCodeStaff(c: any, jeton: string) {
  return renvoyer(c, cibleStaff(c.env), jeton);
}

// Purge quotidienne (cron 4 h) : codes de plus d'un jour, appareils expirés.
export async function purgerDoubleAuthentification(env: any): Promise<void> {
  const maintenant = new Date();
  const ilYaUnJour = new Date(maintenant.getTime() - 24 * 3600 * 1000).toISOString();
  await supabaseDelete(env, 'codes_connexion', { created_at: `lt.${ilYaUnJour}` });
  await supabaseDelete(env, 'staff_codes_connexion', { created_at: `lt.${ilYaUnJour}` }).catch(() => {});
  await supabaseDelete(env, 'appareils_confiance', { expires_at: `lt.${maintenant.toISOString()}` });
}

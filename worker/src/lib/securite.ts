// worker/src/lib/securite.ts
// Origines autorisées (CORS + CSRF) et options des cookies de session.
//
// Le frontend (app citoyenne ET backoffice) appelle l'API en same-origin via /api/...,
// relayé vers ce Worker par frontend/functions/[[path]].js : le navigateur envoie donc
// Origin: https://plateforme-agora.fr (ou l'adresse .pages.dev de secours), transmise telle
// quelle par le relais. Toujours une comparaison EXACTE (regex ancrée), jamais un
// endsWith/includes : avant le 2026-10-23, toute origine finissant par ".pages.dev" ou
// contenant "localhost" était acceptée avec les cookies (n'importe quel site pirate.pages.dev
// pouvait lire les données d'un utilisateur connecté). Historique : docs/journal-correctifs.md.
import type { MiddlewareHandler } from 'hono';
import { supabaseCount, supabaseInsert, supabaseDelete } from '../db';

const ORIGINES_PROD = [
  /^https:\/\/([a-z0-9-]+\.)*plateforme-agora\.fr$/,
  /^https:\/\/([a-z0-9-]+\.)?newappcitoyenne\.pages\.dev$/, // adresse de secours + aperçus de déploiement
];
// Développement local uniquement : ENVIRONNEMENT=dev est posé dans .dev.vars, jamais dans
// wrangler.toml — en production ces origines sont refusées.
const ORIGINES_DEV = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d{1,5})?$/;

export function origineAutorisee(origine: string | null | undefined, env?: { ENVIRONNEMENT?: string }): boolean {
  if (!origine) return false;
  if (ORIGINES_PROD.some((r) => r.test(origine))) return true;
  return env?.ENVIRONNEMENT === 'dev' && ORIGINES_DEV.test(origine);
}

const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF : refuse toute écriture venant d'un autre site. Sans en-tête Origin (appel serveur à
// serveur, ex. webhook Resend — déjà protégé par sa signature svix), on laisse passer sauf si
// le navigateur indique explicitement une requête inter-sites (Sec-Fetch-Site).
export const protectionCsrf: MiddlewareHandler = async (c, next) => {
  if (METHODES_SURES.has(c.req.method)) return next();
  const origine = c.req.header('Origin');
  const refuse = origine
    ? !origineAutorisee(origine, c.env)
    : c.req.header('Sec-Fetch-Site') === 'cross-site';
  if (refuse) return c.json({ erreur: 'Origine non autorisée' }, 403);
  return next();
};

// Cookies de session : grâce au relais same-origin, ils sont posés sur plateforme-agora.fr —
// SameSite=Lax suffit (plus besoin de None, qui les envoyait aussi depuis des sites tiers).
export const OPTIONS_COOKIE = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const;

// Comparaison de chaînes en temps constant (secrets) — évite qu'un attaquant devine une valeur
// caractère par caractère en mesurant le temps de réponse.
export function egaliteTempsConstant(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// IP réelle du visiteur. Derrière le relais /api (frontend/functions/[[path]].js),
// CF-Connecting-IP vaut l'IP de sortie des Workers Cloudflare, COMMUNE à tous les visiteurs : le
// relais transmet donc l'IP réelle dans X-Agora-Client-IP, authentifiée par le secret partagé
// RELAIS_SECRET (sans ce secret, n'importe qui appelant workers.dev en direct pourrait choisir
// son IP et contourner la limite). Appel direct sans secret valide → CF-Connecting-IP.
export function ipClient(c: any): string | null {
  const secret = c.env?.RELAIS_SECRET;
  const relais = c.req.header('X-Agora-Relais');
  if (secret && relais && egaliteTempsConstant(relais, secret)) return c.req.header('X-Agora-Client-IP') || null;
  return c.req.header('CF-Connecting-IP') || null;
}

// Limite de tentatives via les bindings Rate Limiting de Cloudflare (wrangler.toml) :
// LIMITEUR_STRICT (5/min) et LIMITEUR_LARGE (20/min). parEmail : la clé inclut l'email du corps
// JSON — freine l'acharnement sur UN compte sans pénaliser plusieurs habitants derrière la même
// connexion (Wi-Fi de la salle des fêtes un jour de lancement).
// Inactive tant que RELAIS_SECRET n'est pas configuré : sinon tous les visiteurs passant par
// /api partageraient le même compteur (IP de sortie Cloudflare) → blocage général.
export function limiterDebit(nomBinding: 'LIMITEUR_STRICT' | 'LIMITEUR_LARGE', options: { parEmail?: boolean } = {}): MiddlewareHandler {
  return async (c, next) => {
    const limiteur = (c.env as any)?.[nomBinding];
    if (!limiteur || !(c.env as any)?.RELAIS_SECRET || METHODES_SURES.has(c.req.method)) return next();
    const ip = ipClient(c);
    if (!ip) return next();

    let cle = `${ip}:${c.req.routePath}`;
    if (options.parEmail) {
      const corps: any = await c.req.json().catch(() => null);
      const email = typeof corps?.email === 'string' ? corps.email.trim().toLowerCase() : '';
      if (email) cle += `:${email}`;
    }
    const { success } = await limiteur.limit({ key: cle });
    if (!success) {
      c.header('Retry-After', '60');
      return c.json({ erreur: 'Trop de tentatives, réessayez dans une minute.' }, 429);
    }
    return next();
  };
}

// Blocage d'un compte après trop d'échecs de mot de passe (table tentatives_connexion, migration
// 083). Plafond STRICT par compte, indépendant de l'IP — complète le limiteur Cloudflare, qui est
// approximatif (premier blocage constaté vers la 47e tentative en rafale, 2026-10-23).
// - Comptés que l'email existe ou non : ne révèle jamais l'existence d'un compte.
// - Ne bloque que le mot de passe : lien de connexion et « Mot de passe oublié » restent possibles,
//   un tiers qui provoque le blocage n'empêche donc pas le vrai titulaire d'entrer.
// - Fail-open : si la table manque (migration non passée) ou si Supabase échoue ici, la connexion
//   fonctionne quand même — on ne prend jamais le risque de bloquer tout le monde.
// communeId null = backoffice (staff).
export const MAX_ECHECS_CONNEXION = 10;
export const FENETRE_ECHECS_MS = 15 * 60 * 1000;
export const MESSAGE_TROP_DE_TENTATIVES = 'Trop de tentatives. Réessayez dans 15 minutes ou utilisez « Mot de passe oublié ».';

const filtreCompte = (communeId: string | null, email: string) => ({
  email: `eq.${email.trim().toLowerCase()}`,
  commune_id: communeId ? `eq.${communeId}` : 'is.null',
});

export async function connexionVerrouillee(env: any, communeId: string | null, email: string): Promise<boolean> {
  try {
    const echecs = await supabaseCount(env, 'tentatives_connexion', {
      ...filtreCompte(communeId, email),
      created_at: `gte.${new Date(Date.now() - FENETRE_ECHECS_MS).toISOString()}`,
    });
    return echecs >= MAX_ECHECS_CONNEXION;
  } catch (e) {
    console.error('Verrou de connexion indisponible (fail-open) :', e);
    return false;
  }
}

export async function enregistrerEchecConnexion(env: any, communeId: string | null, email: string): Promise<void> {
  try {
    await supabaseInsert(env, 'tentatives_connexion', { commune_id: communeId, email: email.trim().toLowerCase() });
  } catch (e) {
    console.error('Enregistrement d\'échec de connexion impossible :', e);
  }
}

export async function effacerEchecsConnexion(env: any, communeId: string | null, email: string): Promise<void> {
  try {
    await supabaseDelete(env, 'tentatives_connexion', filtreCompte(communeId, email));
  } catch (e) {
    console.error('Remise à zéro des échecs de connexion impossible :', e);
  }
}

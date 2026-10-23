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

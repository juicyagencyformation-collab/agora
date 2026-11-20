// worker/src/backoffice/auth.ts
// Authentification du staff backoffice (Juicy Solutions). Miroir de worker/src/auth.ts côté
// citoyen mais SANS commune_id, avec un scope 'backoffice' dans le JWT et des cookies dédiés
// (agora_bo / agora_bo_refresh). Aucun /register : les comptes staff sont créés uniquement en
// base directement (même logique de sécurité que le rôle superadmin).
import { Hono } from 'hono';
import { z } from 'zod';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';
import { verifierMotDePasse, hasherMotDePasse } from '../lib/password';
import { OPTIONS_COOKIE, connexionVerrouillee, enregistrerEchecConnexion, effacerEchecsConnexion, MESSAGE_TROP_DE_TENTATIVES } from '../lib/securite';
import { backofficeMiddleware, roleStaff } from '../middleware/backoffice';
import { demarrerCodeStaff, verifierCodeStaff, renvoyerCodeStaff, finDuCodeDuJour } from '../lib/double-authentification';

const app = new Hono();

async function hasherToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function genererRefreshToken(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

// Double authentification « une fois par jour » (migration 112, lib/double-authentification.ts) :
// chaque session porte l'heure jusqu'à laquelle le code du jour vaut (lendemain 5 h, Paris). Le
// jeton d'accès n'en dépasse jamais l'échéance ; au-delà, /refresh refuse et demande le code
// (sans le mot de passe : le jeton de rafraîchissement prouve déjà la session).
async function ouvrirSession(c: any, staff_id: string, mfaJusqu: Date) {
  const accessToken = await sign(
    { staff_id, scope: 'backoffice', exp: Math.floor(Math.min(Date.now() + 900 * 1000, mfaJusqu.getTime()) / 1000) },
    c.env.JWT_SECRET,
  );
  const refreshToken = genererRefreshToken();
  await supabaseInsert(c.env, 'staff_refresh_tokens', {
    staff_id,
    token_hash: await hasherToken(refreshToken),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    mfa_valide_jusqu: mfaJusqu.toISOString(),
  });
  setCookie(c, 'agora_bo', accessToken, { ...OPTIONS_COOKIE, maxAge: 900 });
  setCookie(c, 'agora_bo_refresh', refreshToken, { ...OPTIONS_COOKIE, maxAge: 30 * 24 * 3600 });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post('/login', async (c) => {
  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  // Verrou par compte (commune null = backoffice), voir lib/securite.ts.
  if (await connexionVerrouillee(c.env, null, body.data.email)) return c.json({ erreur: MESSAGE_TROP_DE_TENTATIVES }, 429);

  const [staff] = await supabaseSelect(c.env, 'staff_backoffice', {
    select: 'id,nom,email,password_hash,actif',
    email: `eq.${body.data.email}`,
  });

  if (!staff || !staff.actif || !(await verifierMotDePasse(body.data.password, staff.password_hash))) {
    await enregistrerEchecConnexion(c.env, null, body.data.email);
    return c.json({ erreur: 'Email ou mot de passe incorrect' }, 401);
  }
  await effacerEchecsConnexion(c.env, null, body.data.email);

  // Bascule silencieuse vers PBKDF2 si le hash stocké était encore en ancien format
  // (SHA-256 sans sel) — cohérent avec le comportement côté citoyen.
  if (!staff.password_hash.startsWith('pbkdf2$')) {
    const nouveauHash = await hasherMotDePasse(body.data.password);
    await supabaseUpdate(c.env, 'staff_backoffice', { password_hash: nouveauHash }, { id: `eq.${staff.id}` });
  }

  // Mot de passe bon : pas encore de session, un code part par email (lib/double-authentification.ts).
  const attente = await demarrerCodeStaff(c, staff);
  if (!attente) return c.json({ erreur: "Le code n'a pas pu être envoyé par email. Réessayez dans quelques minutes." }, 503);
  return c.json({ double_authentification: true, ...attente });
});

// Session de rafraîchissement valide portée par le cookie (sans regarder le code du jour), ou null.
async function sessionDuCookie(c: any) {
  const refreshToken = getCookie(c, 'agora_bo_refresh');
  if (!refreshToken) return null;
  const [enregistrement] = await supabaseSelect(c.env, 'staff_refresh_tokens', {
    select: 'id,staff_id,expires_at,revoked,mfa_valide_jusqu',
    token_hash: `eq.${await hasherToken(refreshToken)}`,
  });
  if (!enregistrement || enregistrement.revoked || new Date(enregistrement.expires_at) < new Date()) return null;
  return enregistrement;
}

// POST /demander-code — code du jour quand la session est encore valide mais que le code d'hier a
// expiré (/refresh a répondu code_requis) : pas besoin de retaper le mot de passe.
app.post('/demander-code', async (c) => {
  const session = await sessionDuCookie(c);
  if (!session) return c.json({ erreur: 'Session expirée, reconnexion requise' }, 401);
  const [staff] = await supabaseSelect(c.env, 'staff_backoffice', { select: 'id,nom,email,actif', id: `eq.${session.staff_id}` });
  if (!staff?.actif) return c.json({ erreur: 'Compte inactif' }, 401);
  const attente = await demarrerCodeStaff(c, staff);
  if (!attente) return c.json({ erreur: "Le code n'a pas pu être envoyé par email. Réessayez dans quelques minutes." }, 503);
  return c.json({ double_authentification: true, ...attente });
});

const codeSchema = z.object({ jeton: z.string().min(40).max(100), code: z.string().trim().regex(/^\d{6}$/, 'Le code compte 6 chiffres.') });

// POST /login/code — code reçu par email : ouvre la session jusqu'au lendemain 5 h (Paris).
app.post('/login/code', async (c) => {
  const body = codeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: body.error.issues[0]?.message || 'Code invalide.' }, 400);
  const resultat = await verifierCodeStaff(c, body.data.jeton, body.data.code);
  if (!resultat.ok) return c.json({ erreur: resultat.erreur }, resultat.statut);
  const [staff] = await supabaseSelect(c.env, 'staff_backoffice', { select: 'id,nom,actif', id: `eq.${resultat.staff_id}` });
  if (!staff?.actif) return c.json({ erreur: 'Compte inactif' }, 401);
  // L'ancienne session de ce navigateur (code d'hier expiré) est remplacée, pas laissée active.
  const ancienne = await sessionDuCookie(c);
  if (ancienne && ancienne.staff_id === staff.id) {
    await supabaseUpdate(c.env, 'staff_refresh_tokens', { revoked: true }, { id: `eq.${ancienne.id}` });
  }
  await supabaseUpdate(c.env, 'staff_backoffice', { derniere_connexion_at: new Date().toISOString() }, { id: `eq.${staff.id}` });
  await ouvrirSession(c, staff.id, finDuCodeDuJour());
  return c.json({ ok: true, nom: staff.nom });
});

const renvoiSchema = z.object({ jeton: z.string().min(40).max(100) });

app.post('/login/renvoyer-code', async (c) => {
  const body = renvoiSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: 'Demande invalide.' }, 400);
  const resultat = await renvoyerCodeStaff(c, body.data.jeton);
  if (!resultat.ok) return c.json({ erreur: resultat.erreur }, resultat.statut);
  return c.json({ ok: true });
});

app.post('/refresh', async (c) => {
  const enregistrement = await sessionDuCookie(c);
  if (!enregistrement) {
    deleteCookie(c, 'agora_bo_refresh', { path: '/' });
    return c.json({ erreur: 'Session expirée, reconnexion requise' }, 401);
  }
  // Code du jour expiré (ou session antérieure à la double authentification) : la session reste,
  // mais rien ne s'ouvre sans le code. Le cookie est gardé pour /demander-code.
  if (!enregistrement.mfa_valide_jusqu || new Date(enregistrement.mfa_valide_jusqu) <= new Date()) {
    return c.json({ erreur: 'Code du jour requis', code_requis: true }, 401);
  }

  // Rotation : le refresh token consommé est révoqué, un nouveau couple est émis.
  await supabaseUpdate(c.env, 'staff_refresh_tokens', { revoked: true }, { id: `eq.${enregistrement.id}` });
  await ouvrirSession(c, enregistrement.staff_id, new Date(enregistrement.mfa_valide_jusqu));
  return c.json({ ok: true });
});

app.post('/logout', async (c) => {
  const refreshToken = getCookie(c, 'agora_bo_refresh');
  if (refreshToken) {
    const hash = await hasherToken(refreshToken);
    await supabaseUpdate(c.env, 'staff_refresh_tokens', { revoked: true }, { token_hash: `eq.${hash}` });
  }
  deleteCookie(c, 'agora_bo', { path: '/' });
  deleteCookie(c, 'agora_bo_refresh', { path: '/' });
  return c.json({ ok: true });
});

app.get('/me', backofficeMiddleware, async (c) => {
  const staff_id = c.get('staff_id');
  const [staff] = await supabaseSelect(c.env, 'staff_backoffice', {
    select: 'id,nom,email', id: `eq.${staff_id}`,
  });
  if (!staff) return c.json({ erreur: 'Compte introuvable' }, 401);
  return c.json({ staff: { ...staff, role: await roleStaff(c) } });
});

export default app;

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
import { backofficeMiddleware } from '../middleware/backoffice';

const app = new Hono();

async function hasherToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function genererRefreshToken(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

const COOKIE_BASE = { httpOnly: true, secure: true, sameSite: 'None', path: '/' } as const;

async function ouvrirSession(c: any, staff_id: string) {
  const accessToken = await sign(
    { staff_id, scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 },
    c.env.JWT_SECRET,
  );
  const refreshToken = genererRefreshToken();
  await supabaseInsert(c.env, 'staff_refresh_tokens', {
    staff_id,
    token_hash: await hasherToken(refreshToken),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  setCookie(c, 'agora_bo', accessToken, { ...COOKIE_BASE, maxAge: 900 });
  setCookie(c, 'agora_bo_refresh', refreshToken, { ...COOKIE_BASE, maxAge: 30 * 24 * 3600 });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post('/login', async (c) => {
  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [staff] = await supabaseSelect(c.env, 'staff_backoffice', {
    select: 'id,nom,password_hash,actif',
    email: `eq.${body.data.email}`,
  });

  if (!staff || !staff.actif || !(await verifierMotDePasse(body.data.password, staff.password_hash))) {
    return c.json({ erreur: 'Email ou mot de passe incorrect' }, 401);
  }

  // Bascule silencieuse vers PBKDF2 si le hash stocké était encore en ancien format
  // (SHA-256 sans sel) — cohérent avec le comportement côté citoyen.
  if (!staff.password_hash.startsWith('pbkdf2$')) {
    const nouveauHash = await hasherMotDePasse(body.data.password);
    await supabaseUpdate(c.env, 'staff_backoffice', { password_hash: nouveauHash }, { id: `eq.${staff.id}` });
  }

  await supabaseUpdate(c.env, 'staff_backoffice', { derniere_connexion_at: new Date().toISOString() }, { id: `eq.${staff.id}` });
  await ouvrirSession(c, staff.id);
  return c.json({ ok: true, nom: staff.nom });
});

app.post('/refresh', async (c) => {
  const refreshToken = getCookie(c, 'agora_bo_refresh');
  if (!refreshToken) return c.json({ erreur: 'Session expirée' }, 401);

  const hash = await hasherToken(refreshToken);
  const [enregistrement] = await supabaseSelect(c.env, 'staff_refresh_tokens', {
    select: 'id,staff_id,expires_at,revoked',
    token_hash: `eq.${hash}`,
  });

  if (!enregistrement || enregistrement.revoked || new Date(enregistrement.expires_at) < new Date()) {
    deleteCookie(c, 'agora_bo_refresh', { path: '/' });
    return c.json({ erreur: 'Session expirée, reconnexion requise' }, 401);
  }

  // Rotation : le refresh token consommé est révoqué, un nouveau couple est émis.
  await supabaseUpdate(c.env, 'staff_refresh_tokens', { revoked: true }, { id: `eq.${enregistrement.id}` });
  await ouvrirSession(c, enregistrement.staff_id);
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
  return c.json({ staff });
});

export default app;

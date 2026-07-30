// worker/src/middleware/jwt.ts
import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify, decode } from '@tsndr/cloudflare-worker-jwt';

export async function jwtMiddleware(c: Context, next: Next) {
  const token = getCookie(c, 'agora_access');
  if (!token) return c.json({ erreur: 'Non authentifié' }, 401);

  const valide = await verify(token, c.env.JWT_SECRET);
  if (!valide) return c.json({ erreur: 'Session expirée' }, 401);

  const { payload } = decode(token);
  if (!payload?.commune_id || !payload?.user_id) {
    return c.json({ erreur: 'Jeton invalide' }, 401);
  }

  c.set('user_id', payload.user_id);
  c.set('commune_id', payload.commune_id);
  c.set('role', payload.role);
  await next();
}

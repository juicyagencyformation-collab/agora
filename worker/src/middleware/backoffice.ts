// worker/src/middleware/backoffice.ts
// Garde d'accès du backoffice interne Juicy Solutions. Volontairement séparé de
// middleware/jwt.ts (citoyens) : le token staff porte { staff_id, scope: 'backoffice' } et
// AUCUN commune_id. On refuse tout jeton qui n'a pas explicitement ce scope — ainsi un token
// citoyen (même superadmin), qui n'a pas ce scope, ne peut structurellement pas atteindre
// une route /backoffice/*. Isolation stricte des deux périmètres (cf. CLAUDE.md).
import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify, decode } from '@tsndr/cloudflare-worker-jwt';

export async function backofficeMiddleware(c: Context, next: Next) {
  const token = getCookie(c, 'agora_bo');
  if (!token) return c.json({ erreur: 'Non authentifié' }, 401);

  const valide = await verify(token, c.env.JWT_SECRET);
  if (!valide) return c.json({ erreur: 'Session expirée' }, 401);

  const { payload } = decode(token);
  if (payload?.scope !== 'backoffice' || !payload?.staff_id) {
    return c.json({ erreur: 'Jeton invalide' }, 401);
  }

  c.set('staff_id', payload.staff_id);
  await next();
}

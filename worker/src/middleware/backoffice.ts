// worker/src/middleware/backoffice.ts
// Garde d'accès du backoffice interne Juicy Solutions. Volontairement séparé de
// middleware/jwt.ts (citoyens) : le token staff porte { staff_id, scope: 'backoffice' } et
// AUCUN commune_id. On refuse tout jeton qui n'a pas explicitement ce scope — ainsi un token
// citoyen (même superadmin), qui n'a pas ce scope, ne peut structurellement pas atteindre
// une route /backoffice/*. Isolation stricte des deux périmètres (cf. CLAUDE.md).
import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify, decode } from '@tsndr/cloudflare-worker-jwt';
import { supabaseSelect } from '../db';

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

// Rôle du compte staff (migration 094, 2026-11-04) : « admin » (Léandre) ou « assistant » (VA).
// Lu en base à chaque appel, pas dans le jeton : un changement de rôle s'applique tout de suite.
// Tolérant tant que la colonne n'existe pas (migration pas encore passée) : tout le monde est admin.
export async function roleStaff(c: Context): Promise<'admin' | 'assistant'> {
  try {
    const [staff] = await supabaseSelect(c.env, 'staff_backoffice', { select: 'role', id: `eq.${c.get('staff_id')}` });
    return staff?.role === 'assistant' ? 'assistant' : 'admin';
  } catch {
    return 'admin';
  }
}

// Réglages sensibles (SOP §8 « jamais sans validation de Léandre ») : refusés à un assistant
// techniquement, plus seulement par consigne. À placer après backofficeMiddleware.
export async function exigerAdmin(c: Context, next: Next) {
  if (await roleStaff(c) === 'assistant') {
    return c.json({ erreur: 'Réservé au compte administrateur : demande à Léandre.' }, 403);
  }
  await next();
}

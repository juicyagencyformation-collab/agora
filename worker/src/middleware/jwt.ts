// worker/src/middleware/jwt.ts
import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify, decode } from '@tsndr/cloudflare-worker-jwt';
import { supabaseSelect } from '../db';

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

  // Isolation tenant : nul ne peut agir dans une commune autre que la sienne. Le slug de
  // l'URL est résolu par tenantMiddleware (commune_id_resolue), qui tourne toujours avant
  // sur /:slug/*. Toutes les requêtes filtrent déjà par le commune_id du JWT (pas de fuite
  // de données possible), mais on refuse ici explicitement l'accès à une URL d'une autre
  // commune plutôt que de servir silencieusement le mauvais contexte. Superadmin exempté
  // (gestion/dépannage multi-commune). On renvoie le slug de SA commune pour permettre au
  // frontend de rediriger l'utilisateur mal aiguillé.
  const communeUrl = c.get('commune_id_resolue');
  if (communeUrl && payload.commune_id !== communeUrl && payload.role !== 'superadmin') {
    const [sienne] = await supabaseSelect(c.env, 'communes', { select: 'slug', id: `eq.${payload.commune_id}` });
    return c.json({ erreur: 'Accès refusé : ce n\'est pas votre commune.', votre_commune: sienne?.slug ?? null }, 403);
  }

  await next();
}

// worker/src/middleware/tenant.ts
import { Context, Next } from 'hono';
import { supabaseSelect } from '../db';

export async function tenantMiddleware(c: Context, next: Next) {
  const slug = c.req.param('slug');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'id',
    slug: `eq.${slug}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  c.set('slug_commune', slug);
  c.set('commune_id_resolue', commune.id); // utilisé uniquement par /auth/login avant JWT
  await next();
}

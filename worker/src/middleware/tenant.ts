// worker/src/middleware/tenant.ts
import { Context, Next } from 'hono';
import { supabaseSelect } from '../db';

export async function tenantMiddleware(c: Context, next: Next) {
  const slug = c.req.param('slug');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'id,statut_client',
    slug: `eq.${slug}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  // Coupe l'accès pour de vrai (nouvelles connexions/inscriptions ET sessions déjà ouvertes,
  // puisque ce middleware tourne sur toutes les routes /:slug/*) — statut_client n'était
  // jusqu'ici qu'une étiquette d'affichage côté backoffice, sans effet réel sur l'app.
  if (commune.statut_client === 'suspendue' || commune.statut_client === 'resiliee') {
    return c.json({ erreur: 'Cette commune n\'est plus accessible pour le moment. Contactez votre mairie pour plus d\'informations.' }, 403);
  }

  c.set('slug_commune', slug);
  c.set('commune_id_resolue', commune.id); // utilisé uniquement par /auth/login avant JWT
  await next();
}

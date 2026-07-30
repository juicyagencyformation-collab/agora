// worker/src/routes/bulletin.ts
import { estGestionnaire, peutGererRoles } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { sanitizeHtml } from '../lib/sanitize';

const app = new Hono();
app.use('*', jwtMiddleware);

const creationSchema = z.object({
  titre: z.string().min(1).max(200),
  contenu_html: z.string().min(1).max(20000),
});

// GET / — un citoyen ne voit que les bulletins publiés ; un gestionnaire voit aussi les brouillons.
app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const role = c.get('role');

  const filtres: Record<string, string> = {
    select: 'id,auteur_id,titre,contenu_html,statut,publie_at,created_at',
    commune_id: `eq.${commune_id}`,
    order: 'created_at.desc',
  };
  if (!estGestionnaire(role)) filtres.statut = 'eq.publie';

  const bulletins = await supabaseSelect(c.env, 'bulletin_municipal', filtres);
  return c.json({ bulletins });
});

// POST / — admin/élu/superadmin rédige un brouillon (pas publié tant que non validé)
app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [bulletin] = await supabaseInsert(c.env, 'bulletin_municipal', {
    commune_id, auteur_id: user_id, titre: body.data.titre,
    contenu_html: sanitizeHtml(body.data.contenu_html), statut: 'brouillon',
  });
  return c.json({ bulletin_id: bulletin.id }, 201);
});

// PATCH /:id/publier — réservé à élu/superadmin (validation au-dessus de l'auteur admin)
app.patch('/:id/publier', async (c) => {
  const role = c.get('role');
  if (!peutGererRoles(role)) {
    return c.json({ erreur: 'Seul un élu ou le superadmin peut valider la publication' }, 403);
  }
  const commune_id = c.get('commune_id');
  await supabaseUpdate(c.env, 'bulletin_municipal', {
    statut: 'publie', publie_at: new Date().toISOString(),
  }, { id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'bulletin_municipal', {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

export default app;

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

// GET / — Bulletin est un espace de rédaction interne (conseil/admin), pas une publication
// citoyenne : réservé aux gestionnaires, brouillons compris.
app.get('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const bulletins = await supabaseSelect(c.env, 'bulletin_municipal', {
    select: 'id,auteur_id,titre,contenu_html,statut,publie_at,created_at',
    commune_id: `eq.${commune_id}`,
    order: 'created_at.desc',
  });
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

// ── Propositions : rédaction d'un brouillon à plusieurs mains. Un gestionnaire propose sa
// propre version (correction, reformulation...) sans jamais écraser le texte en place —
// seule l'adoption explicite d'une proposition remplace le contenu du brouillon. ──

const propositionSchema = z.object({
  titre: z.string().min(1).max(200),
  contenu_html: z.string().min(1).max(20000),
});

app.get('/:id/propositions', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const propositions = await supabaseSelect(c.env, 'bulletin_propositions', {
    select: 'id,auteur_id,titre,contenu_html,created_at',
    commune_id: `eq.${commune_id}`, bulletin_id: `eq.${c.req.param('id')}`,
    order: 'created_at.asc',
  });
  return c.json({ propositions });
});

app.post('/:id/propositions', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const bulletin_id = c.req.param('id');

  const [bulletin] = await supabaseSelect(c.env, 'bulletin_municipal', {
    select: 'id,statut', commune_id: `eq.${commune_id}`, id: `eq.${bulletin_id}`,
  });
  if (!bulletin) return c.json({ erreur: 'Bulletin introuvable' }, 404);
  if (bulletin.statut !== 'brouillon') return c.json({ erreur: 'Ce bulletin est déjà publié' }, 400);

  const body = propositionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  await supabaseInsert(c.env, 'bulletin_propositions', {
    commune_id, bulletin_id, auteur_id: user_id,
    titre: body.data.titre, contenu_html: sanitizeHtml(body.data.contenu_html),
  });
  return c.json({ ok: true }, 201);
});

// Remplace le contenu du brouillon par cette proposition, puis efface les autres
// propositions du même brouillon : une fois une version adoptée, les autres n'ont plus lieu
// d'être puisque le texte qu'elles comparaient n'existe plus.
app.patch('/:id/propositions/:propId/adopter', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  const bulletin_id = c.req.param('id');

  const [proposition] = await supabaseSelect(c.env, 'bulletin_propositions', {
    select: 'titre,contenu_html', commune_id: `eq.${commune_id}`,
    id: `eq.${c.req.param('propId')}`, bulletin_id: `eq.${bulletin_id}`,
  });
  if (!proposition) return c.json({ erreur: 'Proposition introuvable' }, 404);

  await supabaseUpdate(c.env, 'bulletin_municipal', {
    titre: proposition.titre, contenu_html: proposition.contenu_html,
  }, { id: `eq.${bulletin_id}`, commune_id: `eq.${commune_id}` });

  await supabaseDelete(c.env, 'bulletin_propositions', {
    bulletin_id: `eq.${bulletin_id}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

app.delete('/:id/propositions/:propId', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'bulletin_propositions', {
    id: `eq.${c.req.param('propId')}`, commune_id: `eq.${commune_id}`, bulletin_id: `eq.${c.req.param('id')}`,
  });
  return c.json({ ok: true });
});

// ── Rubriques : rédaction participative — une association ou un habitant propose un texte,
// visible des citoyens seulement une fois validé par la mairie. Indépendant des numéros
// complets ci-dessus (bulletin_municipal), rédigés par la mairie elle-même. ──

const rubriqueSchema = z.object({
  titre: z.string().min(1).max(150),
  nom_auteur: z.string().max(100).optional(),
  contenu_html: z.string().min(1).max(5000),
});

// GET /rubriques — même principe que GET / ci-dessus : réservé aux gestionnaires.
app.get('/rubriques', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const rubriques = await supabaseSelect(c.env, 'bulletin_rubriques', {
    select: 'id,auteur_id,nom_auteur,titre,contenu_html,statut,created_at',
    commune_id: `eq.${commune_id}`,
    order: 'created_at.desc',
  });
  return c.json({ rubriques });
});

// POST /rubriques — réservé aux gestionnaires (rédaction collaborative en interne) : un admin
// propose, un élu/maire/superadmin valide — même principe de double regard que les bulletins
// complets ci-dessus. Jamais publiée directement, toujours en attente de validation.
app.post('/rubriques', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = rubriqueSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  await supabaseInsert(c.env, 'bulletin_rubriques', {
    commune_id, auteur_id: user_id, nom_auteur: body.data.nom_auteur?.trim() || null,
    titre: body.data.titre, contenu_html: sanitizeHtml(body.data.contenu_html), statut: 'attente',
  });
  return c.json({ ok: true }, 201);
});

app.patch('/rubriques/:id/valider', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseUpdate(c.env, 'bulletin_rubriques', { statut: 'validee' }, {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

// Sert à la fois à refuser une rubrique en attente et à en retirer une déjà validée.
app.delete('/rubriques/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'bulletin_rubriques', {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

export default app;

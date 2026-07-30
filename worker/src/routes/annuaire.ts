// worker/src/routes/annuaire.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';

const app = new Hono();
app.use('*', jwtMiddleware);

const CATEGORIES_VALIDES = ['commerce', 'artisan', 'association', 'service_public', 'professionnel', 'autre'] as const;

const creationSchema = z.object({
  nom: z.string().min(1).max(150),
  categorie: z.enum(CATEGORIES_VALIDES),
  description: z.string().max(1000).optional(),
  telephone: z.string().max(30).optional(),
  email: z.string().email().optional(),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const categorie = c.req.query('categorie');

  const filtres: Record<string, string> = {
    select: 'id,user_id,nom,categorie,description,telephone,email',
    commune_id: `eq.${commune_id}`,
    order: 'nom.asc',
  };
  if (categorie && CATEGORIES_VALIDES.includes(categorie as any)) filtres.categorie = `eq.${categorie}`;

  const fiches = await supabaseSelect(c.env, 'annuaire', filtres);
  return c.json({ fiches });
});

// POST / — un citoyen crée SA fiche (liée à son compte, une seule autorisée) ;
// un gestionnaire peut créer une fiche libre (commerce/association sans compte).
app.post('/', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  if (!estGestionnaire(role)) {
    // Citoyen simple : uniquement sa propre fiche, une seule
    const [existante] = await supabaseSelect(c.env, 'annuaire', {
      select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
    });
    if (existante) return c.json({ erreur: 'Vous avez déjà une fiche dans l\'annuaire (modifiez-la plutôt)' }, 400);

    const [fiche] = await supabaseInsert(c.env, 'annuaire', {
      commune_id, user_id, nom: data.nom, categorie: data.categorie,
      description: data.description ?? null, telephone: data.telephone ?? null, email: data.email ?? null,
    });
    return c.json({ fiche_id: fiche.id }, 201);
  }

  // Gestionnaire : fiche libre, sans compte lié (commerce, association...)
  const [fiche] = await supabaseInsert(c.env, 'annuaire', {
    commune_id, user_id: null, nom: data.nom, categorie: data.categorie,
    description: data.description ?? null, telephone: data.telephone ?? null, email: data.email ?? null,
  });
  return c.json({ fiche_id: fiche.id }, 201);
});

app.patch('/:id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const fiche_id = c.req.param('id');

  const [fiche] = await supabaseSelect(c.env, 'annuaire', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}`,
  });
  if (!fiche) return c.json({ erreur: 'Fiche introuvable' }, 404);
  if (fiche.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  const body = creationSchema.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à modifier' }, 400);

  await supabaseUpdate(c.env, 'annuaire', body.data, { id: `eq.${fiche_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const fiche_id = c.req.param('id');

  const [fiche] = await supabaseSelect(c.env, 'annuaire', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}`,
  });
  if (!fiche) return c.json({ erreur: 'Fiche introuvable' }, 404);
  if (fiche.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  await supabaseDelete(c.env, 'annuaire', { id: `eq.${fiche_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

export default app;

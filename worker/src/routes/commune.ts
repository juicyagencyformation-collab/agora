// worker/src/routes/commune.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseUpdate } from '../db';

const app = new Hono();

app.get('/', async (c) => {
  const commune_id = c.get('commune_id_resolue') ?? c.get('commune_id');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'id,slug,nom,population,couleur_theme,couleur_accent,logo_url,lat,lng,photo_jour_seuil_validations,photo_jour_max_par_jour,photo_jour_duree,rayon_validation_enigme,enigme_duree,mur_duree,contact_email,partage_regional,prochain_conseil_date',
    id: `eq.${commune_id}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  return c.json({ commune });
});

app.patch('/', jwtMiddleware, async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');

  const schema = z.object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    nom: z.string().min(1).max(120).optional(),
    couleur_theme: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    couleur_accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    photo_jour_seuil_validations: z.number().int().min(1).max(30).optional(),
    photo_jour_max_par_jour: z.number().int().min(1).max(10).optional(),
    photo_jour_duree: z.enum(['jour', 'semaine', 'mois']).optional(),
    rayon_validation_enigme: z.number().int().min(5).max(500).optional(),
    enigme_duree: z.enum(['48h', 'semaine', 'mois', '6mois', 'an']).optional(),
    mur_duree: z.enum(['24h', '48h']).optional(),
    contact_email: z.string().email().optional(),
    partage_regional: z.boolean().optional(),
    prochain_conseil_date: z.string().datetime().optional().nullable(),
  });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  await supabaseUpdate(c.env, 'communes', body.data, { id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

export default app;

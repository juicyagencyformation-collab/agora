// worker/src/routes/alertes.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';
import { attribuerXp, XP_ACTIONS } from '../lib/gamification';

const app = new Hono();
app.use('*', jwtMiddleware);

const STATUTS_VALIDES = ['ouverte', 'en_cours', 'resolue'] as const;

const creationSchema = z.object({
  titre: z.string().min(1).max(150),
  description: z.string().min(1).max(2000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  image_r2_keys: z.array(z.string()).max(6).optional(),
  urgent: z.boolean().default(false),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const statut = c.req.query('statut');

  const filtres: Record<string, string> = {
    select: 'id,user_id,titre,description,lat,lng,statut,urgent,created_at',
    commune_id: `eq.${commune_id}`,
    order: 'urgent.desc,created_at.desc',
  };
  if (statut && STATUTS_VALIDES.includes(statut as any)) filtres.statut = `eq.${statut}`;

  const alertes = await supabaseSelect(c.env, 'alertes', filtres);
  const ids = alertes.map((a: any) => a.id);
  const images = ids.length ? await supabaseSelect(c.env, 'alerte_images', {
    select: 'alerte_id,url,ordre',
    commune_id: `eq.${commune_id}`,
    alerte_id: `in.(${ids.join(',')})`,
    order: 'ordre.asc',
  }) : [];

  const result = alertes.map((a: any) => ({
    ...a,
    images: images.filter((i: any) => i.alerte_id === a.id).map((i: any) => i.url),
  }));

  return c.json({ alertes: result });
});

app.post('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [alerte] = await supabaseInsert(c.env, 'alertes', {
    commune_id, user_id, titre: data.titre, description: data.description,
    lat: data.lat, lng: data.lng, statut: 'ouverte', urgent: data.urgent,
  });

  if (data.image_r2_keys?.length) {
    await supabaseInsert(c.env, 'alerte_images', data.image_r2_keys.map((key, i) => ({
      commune_id, alerte_id: alerte.id, r2_key: key,
      url: `${c.env.R2_PUBLIC_BASE}/${key}`, ordre: i,
    })));
  }

  const resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.signaler_alerte);

  return c.json({ alerte_id: alerte.id, xp_gagne: resultatXp.xp_gagne, nouveaux_badges: resultatXp.nouveaux_badges }, 201);
});

app.patch('/:id/statut', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const alerte_id = c.req.param('id');

  const schema = z.object({ statut: z.enum(STATUTS_VALIDES) });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  await supabaseUpdate(c.env, 'alertes', { statut: body.data.statut }, {
    id: `eq.${alerte_id}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const alerte_id = c.req.param('id');

  const [alerte] = await supabaseSelect(c.env, 'alertes', {
    select: 'id,user_id', id: `eq.${alerte_id}`, commune_id: `eq.${commune_id}`,
  });
  if (!alerte) return c.json({ erreur: 'Signalement introuvable' }, 404);
  if (alerte.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Vous ne pouvez supprimer que vos propres signalements' }, 403);
  }

  const images = await supabaseSelect(c.env, 'alerte_images', {
    select: 'r2_key',
    commune_id: `eq.${commune_id}`,
    alerte_id: `eq.${alerte_id}`,
  });
  await Promise.all(images.map((img: any) => deleteObject(c.env, img.r2_key)));

  await supabaseDelete(c.env, 'alertes', {
    id: `eq.${alerte_id}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
});

app.post('/upload', async (c) => {
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    return c.json({ erreur: 'Type de fichier non autorisé (jpeg/png/webp uniquement)' }, 400);
  }

  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 8 * 1024 * 1024) {
    return c.json({ erreur: 'Image trop lourde (max 8 Mo)' }, 400);
  }

  const extension = contentType.split('/')[1];
  const key = `${commune_id}/alertes/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

export default app;

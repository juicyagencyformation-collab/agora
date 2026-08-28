// worker/src/routes/alertes_meteo.ts
// Vigilance météo (vent violent, orages, canicule...) affichée en bandeau sur l'accueil — PAS
// un signalement citoyen (voir alertes.ts) : une info officielle/mairie, sans modération.
// Deux origines : "manuel" (posée par un admin/élu/maire, entièrement éditable/supprimable par
// eux) et "auto" (posée par la synchro Météo-France, voir lib/vigilance-meteofrance.ts) — une
// alerte "auto" n'est jamais modifiable ni supprimable à la main, pour ne jamais permettre de
// masquer une vraie vigilance officielle depuis l'app.
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseInsert, supabaseUpdate, supabaseDelete } from '../db';

const app = new Hono();
app.use('*', jwtMiddleware);

const TYPES_VALIDES = [
  'vent_violent', 'pluie_inondation', 'orages', 'crues',
  'neige_verglas', 'canicule', 'grand_froid', 'avalanches',
] as const;
const NIVEAUX_VALIDES = ['jaune', 'orange', 'rouge'] as const;

const creationSchema = z.object({
  type: z.enum(TYPES_VALIDES),
  niveau: z.enum(NIVEAUX_VALIDES),
  debut: z.string().datetime().optional(),
  fin: z.string().datetime().nullable().optional(),
});

const editionSchema = z.object({
  type: z.enum(TYPES_VALIDES).optional(),
  niveau: z.enum(NIVEAUX_VALIDES).optional(),
  debut: z.string().datetime().optional(),
  fin: z.string().datetime().nullable().optional(),
});

// GET / — alertes actuellement actives (fin non atteinte ou pas d'échéance fixée). Accessible
// à tout utilisateur connecté : une info de sécurité ne doit jamais être réservée aux
// gestionnaires. Tri par niveau (rouge d'abord — l'ordre alphabétique inverse suffit ici :
// rouge > orange > jaune), puis par ancienneté.
app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const alertes = await supabaseSelect(c.env, 'alertes_meteo', {
    select: 'id,type,niveau,debut,fin,origine,created_at',
    commune_id: `eq.${commune_id}`,
    or: `(fin.is.null,fin.gt.${new Date().toISOString()})`,
    order: 'niveau.desc,debut.asc',
  });
  return c.json({ alertes });
});

// POST / — pose une alerte manuelle. origine forcée à "manuel" côté serveur, jamais lue depuis
// le corps de la requête.
app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [alerte] = await supabaseInsert(c.env, 'alertes_meteo', {
    commune_id, type: data.type, niveau: data.niveau,
    debut: data.debut ?? new Date().toISOString(), fin: data.fin ?? null, origine: 'manuel',
  });
  return c.json({ alerte }, 201);
});

// PATCH /:id — modifie une alerte manuelle (ex. fermer plus tôt, changer le niveau).
app.patch('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  const id = c.req.param('id');

  const [existante] = await supabaseSelect(c.env, 'alertes_meteo', {
    select: 'id,origine', id: `eq.${id}`, commune_id: `eq.${commune_id}`,
  });
  if (!existante) return c.json({ erreur: 'Introuvable' }, 404);
  if (existante.origine !== 'manuel') return c.json({ erreur: 'Une alerte officielle ne peut pas être modifiée' }, 403);

  const body = editionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (!Object.keys(body.data).length) return c.json({ erreur: 'Aucune modification fournie' }, 400);

  const [alerte] = await supabaseUpdate(c.env, 'alertes_meteo', body.data, { id: `eq.${id}` });
  return c.json({ alerte });
});

// DELETE /:id — supprime une alerte manuelle.
app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  const id = c.req.param('id');

  const [existante] = await supabaseSelect(c.env, 'alertes_meteo', {
    select: 'id,origine', id: `eq.${id}`, commune_id: `eq.${commune_id}`,
  });
  if (!existante) return c.json({ erreur: 'Introuvable' }, 404);
  if (existante.origine !== 'manuel') return c.json({ erreur: 'Une alerte officielle ne peut pas être supprimée' }, 403);

  await supabaseDelete(c.env, 'alertes_meteo', { id: `eq.${id}` });
  return c.json({ ok: true });
});

export default app;

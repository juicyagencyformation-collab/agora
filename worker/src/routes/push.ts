// worker/src/routes/push.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';

const app = new Hono();
app.use('*', jwtMiddleware);

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

app.post('/subscribe', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = subscriptionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  // Un même endpoint (= un même appareil/navigateur) ne peut être lié qu'à un seul compte —
  // on remplace l'éventuel ancien enregistrement plutôt que de dupliquer.
  await supabaseDelete(c.env, 'push_subscriptions', { endpoint: `eq.${body.data.endpoint}` });
  await supabaseInsert(c.env, 'push_subscriptions', {
    commune_id, user_id, endpoint: body.data.endpoint,
    p256dh: body.data.keys.p256dh, auth: body.data.keys.auth,
  });

  return c.json({ ok: true });
});

app.post('/unsubscribe', async (c) => {
  const commune_id = c.get('commune_id');
  const body = await c.req.json().catch(() => ({}));
  if (!body.endpoint) return c.json({ erreur: 'endpoint requis' }, 400);

  await supabaseDelete(c.env, 'push_subscriptions', {
    commune_id: `eq.${commune_id}`, endpoint: `eq.${body.endpoint}`,
  });
  return c.json({ ok: true });
});

app.get('/preferences', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'notif_articles,notif_chasses,notif_enigmes,notif_mur,notif_thermo,notif_agenda,notif_entraide',
    commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  return c.json({
    preferences: user ?? {
      notif_articles: true, notif_chasses: true, notif_enigmes: true,
      notif_mur: true, notif_thermo: true, notif_agenda: true, notif_entraide: true,
    },
  });
});

const preferencesSchema = z.object({
  notif_articles: z.boolean().optional(),
  notif_chasses: z.boolean().optional(),
  notif_enigmes: z.boolean().optional(),
  notif_mur: z.boolean().optional(),
  notif_thermo: z.boolean().optional(),
  notif_agenda: z.boolean().optional(),
  notif_entraide: z.boolean().optional(),
});

app.patch('/preferences', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = preferencesSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  await supabaseUpdate(c.env, 'users', body.data, { id: `eq.${user_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

export default app;

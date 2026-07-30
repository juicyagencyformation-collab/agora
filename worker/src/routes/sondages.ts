// worker/src/routes/sondages.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { attribuerXp, XP_ACTIONS } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';

const app = new Hono();
app.use('*', jwtMiddleware);

const choixSchema = z.object({ label: z.string().min(1).max(120) });
const creationSchema = z.object({
  question: z.string().min(1).max(200),
  choix: z.array(choixSchema).min(2).max(8),
  multi_choix: z.boolean().default(false),
  closes_at: z.string().datetime().optional(),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');

  const sondages = await supabaseSelect(c.env, 'sondages', {
    select: 'id,question,type,closes_at,created_at',
    commune_id: `eq.${commune_id}`,
    order: 'created_at.desc',
  });
  const ids = sondages.map((s: any) => s.id);
  if (!ids.length) return c.json({ sondages: [] });

  const [choix, votes] = await Promise.all([
    supabaseSelect(c.env, 'choix_sondage', {
      select: 'id,sondage_id,label,ordre',
      commune_id: `eq.${commune_id}`,
      sondage_id: `in.(${ids.join(',')})`,
      order: 'ordre.asc',
    }),
    supabaseSelect(c.env, 'votes', {
      select: 'sondage_id,choix_id,user_id',
      commune_id: `eq.${commune_id}`,
      sondage_id: `in.(${ids.join(',')})`,
    }),
  ]);

  const user_id = c.get('user_id');
  const result = sondages.map((s: any) => {
    const choixSondage = choix.filter((ch: any) => ch.sondage_id === s.id);
    const votesSondage = votes.filter((v: any) => v.sondage_id === s.id);
    return {
      ...s,
      multi_choix: s.type === 'multiple',
      choix: choixSondage.map((ch: any) => ({
        id: ch.id,
        label: ch.label,
        total: votesSondage.filter((v: any) => v.choix_id === ch.id).length,
      })),
      total_votes: votesSondage.length,
      mes_votes: votesSondage.filter((v: any) => v.user_id === user_id).map((v: any) => v.choix_id),
    };
  });

  return c.json({ sondages: result });
});

app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [sondage] = await supabaseInsert(c.env, 'sondages', {
    commune_id, user_id, question: data.question,
    type: data.multi_choix ? 'multiple' : 'unique', closes_at: data.closes_at ?? null,
  });

  await supabaseInsert(c.env, 'choix_sondage', data.choix.map((ch, i) => ({
    commune_id, sondage_id: sondage.id, label: ch.label, ordre: i,
  })));

  c.executionCtx.waitUntil((async () => {
    const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_thermo');
    await envoyerNotificationAUtilisateurs(
      c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
      '🌡️ Nouveau sondage', data.question, `/index.html?onglet=thermometre&type=sondage&id=${sondage.id}`,
    );
  })());

  return c.json({ sondage_id: sondage.id }, 201);
});

app.post('/:id/vote', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const sondage_id = c.req.param('id');

  const schema = z.object({ choix_ids: z.array(z.string().uuid()).min(1) });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [sondage] = await supabaseSelect(c.env, 'sondages', {
    select: 'id,type,closes_at',
    commune_id: `eq.${commune_id}`, id: `eq.${sondage_id}`,
  });
  if (!sondage) return c.json({ erreur: 'Sondage introuvable' }, 404);
  if (sondage.closes_at && new Date(sondage.closes_at) < new Date()) {
    return c.json({ erreur: 'Sondage clôturé' }, 400);
  }
  if (sondage.type !== 'multiple' && body.data.choix_ids.length > 1) {
    return c.json({ erreur: 'Une seule réponse autorisée pour ce sondage' }, 400);
  }

  const votesExistants = await supabaseSelect(c.env, 'votes', {
    select: 'id',
    commune_id: `eq.${commune_id}`, sondage_id: `eq.${sondage_id}`, user_id: `eq.${user_id}`,
  });
  const premierVote = votesExistants.length === 0;

  // Remplace l'ensemble des votes de l'utilisateur pour ce sondage (fonctionne pour unique et multiple)
  for (const v of votesExistants) {
    await supabaseDelete(c.env, 'votes', { id: `eq.${v.id}` });
  }
  await supabaseInsert(c.env, 'votes', body.data.choix_ids.map((choix_id) => ({
    commune_id, sondage_id, choix_id, user_id,
  })));

  let resultatXp = { xp_gagne: 0, nouveaux_badges: [] as string[] };
  if (premierVote) {
    resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.voter_sondage);
  }

  return c.json({ ok: true, xp_gagne: resultatXp.xp_gagne, nouveaux_badges: resultatXp.nouveaux_badges });
});

app.patch('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const schema = z.object({ question: z.string().min(1).max(200) });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  await supabaseUpdate(c.env, 'sondages', { question: body.data.question }, {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'sondages', {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

export default app;

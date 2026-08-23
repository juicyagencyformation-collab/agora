// worker/src/routes/mur.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { attribuerXp, XP_ACTIONS, incrementerCompteurUtilisateur } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';

const app = new Hono();
app.use('*', jwtMiddleware);

const creationPostSchema = z.object({
  contenu: z.string().min(1).max(2000),
});
const creationCommentaireSchema = z.object({
  contenu: z.string().min(1).max(500),
});
const reactionSchema = z.object({
  type: z.enum(['jaime', 'jadore', 'utile']),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const curseur = c.req.query('curseur');

  const filtres: Record<string, string> = {
    select: 'id,user_id,contenu,created_at',
    commune_id: `eq.${commune_id}`,
    statut: 'eq.visible',
    order: 'created_at.desc',
    limit: '20',
  };
  if (curseur) filtres.created_at = `lt.${curseur}`;

  const posts = await supabaseSelect(c.env, 'posts', filtres);
  const ids = posts.map((p: any) => p.id);
  if (!ids.length) return c.json({ posts: [] });

  const user_id = c.get('user_id');
  const idsAuteurs = [...new Set(posts.map((p: any) => p.user_id))];
  const [commentaires, reactions, mesSignalements, auteurs] = await Promise.all([
    supabaseSelect(c.env, 'comments', {
      select: 'id,post_id,user_id,contenu,created_at',
      commune_id: `eq.${commune_id}`,
      post_id: `in.(${ids.join(',')})`,
      order: 'created_at.asc',
    }),
    supabaseSelect(c.env, 'reactions', {
      select: 'post_id,user_id,type',
      commune_id: `eq.${commune_id}`,
      post_id: `in.(${ids.join(',')})`,
    }),
    supabaseSelect(c.env, 'mur_signalements', {
      select: 'post_id',
      commune_id: `eq.${commune_id}`,
      post_id: `in.(${ids.join(',')})`,
      user_id: `eq.${user_id}`,
    }),
    supabaseSelect(c.env, 'users', {
      select: 'id,prenom,nom',
      commune_id: `eq.${commune_id}`,
      id: `in.(${idsAuteurs.join(',')})`,
    }),
  ]);
  const mesPostsSignales = new Set(mesSignalements.map((s: any) => s.post_id));

  const result = posts.map((p: any) => {
    const auteur = auteurs.find((a: any) => a.id === p.user_id);
    return {
      ...p,
      auteur_prenom: auteur?.prenom ?? '?',
      auteur_nom: auteur?.nom ?? '',
      commentaires: commentaires.filter((cm: any) => cm.post_id === p.id),
      reactions: ['jaime', 'jadore', 'utile'].map((type) => ({
        type,
        total: reactions.filter((r: any) => r.post_id === p.id && r.type === type).length,
      })),
      ma_reaction: reactions.find((r: any) => r.post_id === p.id && r.user_id === user_id)?.type ?? null,
      deja_signale: mesPostsSignales.has(p.id),
    };
  });

  return c.json({ posts: result });
});

app.post('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationPostSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [post] = await supabaseInsert(c.env, 'posts', {
    commune_id, user_id, contenu: body.data.contenu, photo_url: null,
  });

  await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.publier_post);

  c.executionCtx.waitUntil((async () => {
    const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_mur');
    await envoyerNotificationAUtilisateurs(
      c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
      '💬 Nouveau message sur le Mur', body.data.contenu.slice(0, 100),
      `/index.html?onglet=mur&type=post&id=${post.id}`,
    );
  })());

  return c.json({ post_id: post.id }, 201);
});

app.delete('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const post_id = c.req.param('id');

  const [post] = await supabaseSelect(c.env, 'posts', {
    select: 'id,user_id,statut',
    commune_id: `eq.${commune_id}`, id: `eq.${post_id}`,
  });
  if (!post) return c.json({ erreur: 'Post introuvable' }, 404);
  if (post.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  // Message signalé puis effectivement supprimé : signalement fondé, on récompense les signaleurs.
  if (post.statut === 'masquee') {
    const signalements = await supabaseSelect(c.env, 'mur_signalements', {
      select: 'user_id', commune_id: `eq.${commune_id}`, post_id: `eq.${post_id}`,
    });
    for (const s of signalements) {
      await incrementerCompteurUtilisateur(c.env, commune_id, s.user_id, 'signalements_confirmes');
      await attribuerXp(c.env, commune_id, s.user_id, XP_ACTIONS.signalement_confirme);
    }
  }

  await supabaseDelete(c.env, 'posts', { id: `eq.${post_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// Un seul signalement suffit à masquer le message, le temps qu'un gestionnaire tranche —
// même principe que Photo du jour et Énigme photo.
app.post('/:id/signaler', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const post_id = c.req.param('id');

  const [post] = await supabaseSelect(c.env, 'posts', {
    select: 'id', commune_id: `eq.${commune_id}`, id: `eq.${post_id}`,
  });
  if (!post) return c.json({ erreur: 'Post introuvable' }, 404);

  const [existant] = await supabaseSelect(c.env, 'mur_signalements', {
    select: 'id', commune_id: `eq.${commune_id}`, post_id: `eq.${post_id}`, user_id: `eq.${user_id}`,
  });
  if (!existant) {
    await supabaseInsert(c.env, 'mur_signalements', { commune_id, post_id, user_id });
  }
  await supabaseUpdate(c.env, 'posts', { statut: 'masquee' }, {
    id: `eq.${post_id}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
});

// GET /moderation/en-attente — file de revue des messages masqués (gestionnaires uniquement)
app.get('/moderation/en-attente', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const posts = await supabaseSelect(c.env, 'posts', {
    select: 'id,user_id,contenu,created_at',
    commune_id: `eq.${commune_id}`, statut: 'eq.masquee',
    order: 'created_at.desc',
  });
  const ids = posts.map((p: any) => p.id);
  const signalements = ids.length ? await supabaseSelect(c.env, 'mur_signalements', {
    select: 'post_id', commune_id: `eq.${commune_id}`, post_id: `in.(${ids.join(',')})`,
  }) : [];

  const result = posts.map((p: any) => ({
    ...p,
    total_signalements: signalements.filter((s: any) => s.post_id === p.id).length,
  }));

  return c.json({ posts: result });
});

app.patch('/:id/restaurer', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseUpdate(c.env, 'posts', { statut: 'visible' }, {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

app.post('/:id/commentaires', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const post_id = c.req.param('id');

  const body = creationCommentaireSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [commentaire] = await supabaseInsert(c.env, 'comments', {
    commune_id, post_id, user_id, contenu: body.data.contenu,
  });

  return c.json({ commentaire_id: commentaire.id }, 201);
});

app.post('/:id/reactions', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const post_id = c.req.param('id');

  const body = reactionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [existante] = await supabaseSelect(c.env, 'reactions', {
    select: 'id,type',
    commune_id: `eq.${commune_id}`, post_id: `eq.${post_id}`, user_id: `eq.${user_id}`,
  });

  if (existante && existante.type === body.data.type) {
    await supabaseDelete(c.env, 'reactions', { id: `eq.${existante.id}` });
    return c.json({ ok: true, action: 'retirée' });
  }
  if (existante) {
    await supabaseUpdate(c.env, 'reactions', { type: body.data.type }, { id: `eq.${existante.id}` });
    return c.json({ ok: true, action: 'modifiée' });
  }
  await supabaseInsert(c.env, 'reactions', {
    commune_id, post_id, user_id, type: body.data.type,
  });
  return c.json({ ok: true, action: 'ajoutée' });
});

export default app;

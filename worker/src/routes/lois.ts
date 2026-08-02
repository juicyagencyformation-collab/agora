// worker/src/routes/lois.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';

const app = new Hono();
app.use('*', jwtMiddleware);

const SOURCES = ['assemblee_nationale', 'senat', 'parlement_europeen', 'autre'] as const;
const STATUTS = ['depose', 'commission', 'discussion', 'adopte', 'rejete'] as const;

const creationSchema = z.object({
  titre: z.string().min(1).max(300),
  description: z.string().min(1).max(5000),
  source: z.enum(SOURCES),
  statut: z.enum(STATUTS).default('depose'),
  url_source: z.string().url(),
});

// GET / — liste globale (pas de commune_id sur la table lois elle-même), avec le vote et
// les stats d'opinion propres à la commune du citoyen qui consulte.
app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const lois = await supabaseSelect(c.env, 'lois', {
    select: 'id,titre,description,source,statut,url_source,created_at',
    order: 'created_at.desc',
  });
  const ids = lois.map((l: any) => l.id);

  const votes = ids.length ? await supabaseSelect(c.env, 'lois_votes', {
    select: 'loi_id,position,user_id',
    commune_id: `eq.${commune_id}`,
    loi_id: `in.(${ids.join(',')})`,
  }) : [];

  const result = lois.map((l: any) => {
    const votesLoi = votes.filter((v: any) => v.loi_id === l.id);
    return {
      ...l,
      mon_vote: votesLoi.find((v: any) => v.user_id === user_id)?.position ?? null,
      opinion_commune: {
        pour: votesLoi.filter((v: any) => v.position === 'pour').length,
        contre: votesLoi.filter((v: any) => v.position === 'contre').length,
        mitige: votesLoi.filter((v: any) => v.position === 'mitige').length,
      },
    };
  });

  return c.json({ lois: result });
});

app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [loi] = await supabaseInsert(c.env, 'lois', { ...body.data, ajoute_par: user_id });
  return c.json({ loi_id: loi.id }, 201);
});

app.patch('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const id = c.req.param('id');

  const body = creationSchema.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  await supabaseUpdate(c.env, 'lois', { ...body.data, updated_at: new Date().toISOString() }, { id: `eq.${id}` });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const id = c.req.param('id');
  await supabaseDelete(c.env, 'lois', { id: `eq.${id}` });
  return c.json({ ok: true });
});

// Vote citoyen symbolique — un seul par personne, modifiable (change d'avis possible).
const voteSchema = z.object({ position: z.enum(['pour', 'contre', 'mitige']) });

app.post('/:id/voter', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const loi_id = c.req.param('id');

  const body = voteSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [existant] = await supabaseSelect(c.env, 'lois_votes', {
    select: 'id', loi_id: `eq.${loi_id}`, commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
  });

  if (existant) {
    await supabaseUpdate(c.env, 'lois_votes', { position: body.data.position }, { id: `eq.${existant.id}` });
  } else {
    await supabaseInsert(c.env, 'lois_votes', { loi_id, commune_id, user_id, position: body.data.position });
  }
  return c.json({ ok: true });
});

// Commentaires — isolés par commune, avec signalement (masquage immédiat, revue mairie).
app.get('/:id/commentaires', async (c) => {
  const commune_id = c.get('commune_id');
  const loi_id = c.req.param('id');

  const commentaires = await supabaseSelect(c.env, 'lois_commentaires', {
    select: 'id,user_id,contenu,created_at',
    loi_id: `eq.${loi_id}`, commune_id: `eq.${commune_id}`, masque: 'eq.false',
    order: 'created_at.asc',
  });

  const idsAuteurs = [...new Set(commentaires.map((cm: any) => cm.user_id))];
  const auteurs = idsAuteurs.length ? await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom', id: `in.(${idsAuteurs.join(',')})`,
  }) : [];

  const result = commentaires.map((cm: any) => {
    const auteur = auteurs.find((a: any) => a.id === cm.user_id);
    return { ...cm, auteur_prenom: auteur?.prenom ?? '?', auteur_nom: auteur?.nom ?? '' };
  });

  return c.json({ commentaires: result });
});

const commentaireSchema = z.object({ contenu: z.string().min(1).max(1000) });

app.post('/:id/commentaires', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const loi_id = c.req.param('id');

  const body = commentaireSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [commentaire] = await supabaseInsert(c.env, 'lois_commentaires', {
    loi_id, commune_id, user_id, contenu: body.data.contenu,
  });
  return c.json({ commentaire_id: commentaire.id }, 201);
});

app.post('/commentaires/:id/signaler', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const commentaire_id = c.req.param('id');

  const [dejaSignale] = await supabaseSelect(c.env, 'lois_signalements', {
    select: 'id', commentaire_id: `eq.${commentaire_id}`, user_id: `eq.${user_id}`,
  });
  if (dejaSignale) return c.json({ erreur: 'Déjà signalé' }, 400);

  await supabaseInsert(c.env, 'lois_signalements', { commentaire_id, commune_id, user_id });
  await supabaseUpdate(c.env, 'lois_commentaires', { masque: true }, { id: `eq.${commentaire_id}` });
  return c.json({ ok: true });
});

export default app;

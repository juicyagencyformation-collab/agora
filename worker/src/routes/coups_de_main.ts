// worker/src/routes/coups_de_main.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseDelete, supabaseSelect } from '../db';
import { attribuerXp, XP_ACTIONS } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';

const app = new Hono();
app.use('*', jwtMiddleware);

const CATEGORIES_VALIDES = ['bricolage', 'jardinage', 'garde_enfants', 'transport', 'courses', 'autre'] as const;

const creationSchema = z.object({
  type: z.enum(['offre', 'demande']),
  titre: z.string().min(1).max(150),
  description: z.string().min(1).max(1000),
  categorie: z.enum(CATEGORIES_VALIDES),
  duree_jours: z.number().int().min(1).max(90).default(30),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const type = c.req.query('type');
  const categorie = c.req.query('categorie');

  const filtres: Record<string, string> = {
    select: 'id,user_id,type,titre,description,categorie,expires_at,created_at',
    commune_id: `eq.${commune_id}`,
    expires_at: `gt.${new Date().toISOString()}`,
    order: 'created_at.desc',
  };
  if (type && ['offre', 'demande'].includes(type)) filtres.type = `eq.${type}`;
  if (categorie && CATEGORIES_VALIDES.includes(categorie as any)) filtres.categorie = `eq.${categorie}`;

  const annonces = await supabaseSelect(c.env, 'coups_de_main', filtres);
  if (!annonces.length) return c.json({ annonces: [] });

  const idsAuteurs = [...new Set(annonces.map((a: any) => a.user_id))];
  const auteurs = await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom', commune_id: `eq.${commune_id}`, id: `in.(${idsAuteurs.join(',')})`,
  });
  const result = annonces.map((a: any) => {
    const auteur = auteurs.find((u: any) => u.id === a.user_id);
    return { ...a, auteur_prenom: auteur?.prenom ?? '?', auteur_nom: auteur?.nom ?? '' };
  });

  return c.json({ annonces: result });
});

app.post('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const expires_at = new Date(Date.now() + data.duree_jours * 24 * 3600 * 1000).toISOString();

  const [annonce] = await supabaseInsert(c.env, 'coups_de_main', {
    commune_id, user_id, type: data.type, titre: data.titre,
    description: data.description, categorie: data.categorie, expires_at,
  });

  const resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.publier_annonce);

  c.executionCtx.waitUntil((async () => {
    const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_entraide');
    await envoyerNotificationAUtilisateurs(
      c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
      data.type === 'offre' ? '🤲 Nouvelle offre d\'entraide' : '🙏 Nouvelle demande d\'entraide',
      data.titre, `/index.html?onglet=coups-de-main&type=annonce&id=${annonce.id}`,
    );
  })());

  return c.json({ annonce_id: annonce.id, xp_gagne: resultatXp.xp_gagne, nouveaux_badges: resultatXp.nouveaux_badges }, 201);
});

app.delete('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const annonce_id = c.req.param('id');

  const [annonce] = await supabaseSelect(c.env, 'coups_de_main', {
    select: 'id,user_id',
    commune_id: `eq.${commune_id}`, id: `eq.${annonce_id}`,
  });
  if (!annonce) return c.json({ erreur: 'Annonce introuvable' }, 404);
  if (annonce.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  await supabaseDelete(c.env, 'coups_de_main', { id: `eq.${annonce_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

export default app;

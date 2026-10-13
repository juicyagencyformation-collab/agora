// worker/src/routes/coups_de_main.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { attribuerXp, XP_ACTIONS } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';
import { uploaderFichier, deleteObject } from '../storage';
import { photoSuspecte } from '../lib/moderation-image';

const app = new Hono();
app.use('*', jwtMiddleware);

const CATEGORIES_VALIDES = ['bricolage', 'jardinage', 'garde_enfants', 'transport', 'courses', 'informatique', 'cuisine', 'autre'] as const;

const creationSchema = z.object({
  type: z.enum(['offre', 'demande']),
  titre: z.string().min(1).max(150),
  description: z.string().min(1).max(1000),
  categorie: z.enum(CATEGORIES_VALIDES),
  duree_jours: z.number().int().min(1).max(90).default(30),
  contact: z.string().max(300).optional(),
  prix: z.string().max(60).optional(),
  disponibilites: z.string().max(300).optional(),
  photo_r2_key: z.string().optional(),
});

// Distinct de creationSchema.partial() : sans le .default(30), pour ne PAS recalculer
// l'expiration quand on modifie juste le titre sans toucher à la durée. photo_r2_key
// .nullable() en plus de .optional() : permet de retirer explicitement une photo déjà
// jointe (PATCH envoie alors null), sans quoi il n'y aurait aucun moyen de l'enlever.
const editionSchema = z.object({
  type: z.enum(['offre', 'demande']).optional(),
  titre: z.string().min(1).max(150).optional(),
  description: z.string().min(1).max(1000).optional(),
  categorie: z.enum(CATEGORIES_VALIDES).optional(),
  duree_jours: z.number().int().min(1).max(90).optional(),
  contact: z.string().max(300).optional(),
  prix: z.string().max(60).optional(),
  disponibilites: z.string().max(300).optional(),
  photo_r2_key: z.string().nullable().optional(),
  pourvu: z.boolean().optional(),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const type = c.req.query('type');
  const categorie = c.req.query('categorie');

  const filtres: Record<string, string> = {
    select: 'id,user_id,type,titre,description,categorie,contact,prix,disponibilites,photo_url,pourvu,expires_at,created_at',
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
    contact: data.contact?.trim() || null,
    prix: data.prix?.trim() || null,
    disponibilites: data.disponibilites?.trim() || null,
    photo_r2_key: data.photo_r2_key ?? null,
    photo_url: data.photo_r2_key ? `${c.env.R2_PUBLIC_BASE}/${data.photo_r2_key}` : null,
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

  return c.json({ annonce_id: annonce.id, ...resultatXp }, 201);
});

// PATCH /:id — modifier sa propre annonce (ou n'importe laquelle pour un gestionnaire).
app.patch('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const annonce_id = c.req.param('id');

  const [annonce] = await supabaseSelect(c.env, 'coups_de_main', {
    select: 'id,user_id,photo_r2_key', commune_id: `eq.${commune_id}`, id: `eq.${annonce_id}`,
  });
  if (!annonce) return c.json({ erreur: 'Annonce introuvable' }, 404);
  if (annonce.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Vous ne pouvez modifier que vos propres annonces' }, 403);
  }

  const body = editionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const patch: Record<string, unknown> = {};
  if (data.type) patch.type = data.type;
  if (data.titre) patch.titre = data.titre;
  if (data.description) patch.description = data.description;
  if (data.categorie) patch.categorie = data.categorie;
  if (data.contact !== undefined) patch.contact = data.contact.trim() || null;
  if (data.prix !== undefined) patch.prix = data.prix.trim() || null;
  if (data.disponibilites !== undefined) patch.disponibilites = data.disponibilites.trim() || null;
  if (data.pourvu !== undefined) patch.pourvu = data.pourvu;
  // duree_jours fournie = on repart de maintenant pour recalculer l'expiration.
  if (data.duree_jours) patch.expires_at = new Date(Date.now() + data.duree_jours * 24 * 3600 * 1000).toISOString();
  // photo_r2_key fournie (même null = retrait explicite) : remplace l'ancienne, en supprimant
  // l'objet R2 devenu orphelin pour ne pas accumuler de fichiers inutiles.
  if (data.photo_r2_key !== undefined) {
    if (annonce.photo_r2_key) await deleteObject(c.env, annonce.photo_r2_key);
    patch.photo_r2_key = data.photo_r2_key;
    patch.photo_url = data.photo_r2_key ? `${c.env.R2_PUBLIC_BASE}/${data.photo_r2_key}` : null;
  }
  if (Object.keys(patch).length === 0) return c.json({ erreur: 'Aucun champ à modifier' }, 400);

  await supabaseUpdate(c.env, 'coups_de_main', patch, { id: `eq.${annonce_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const annonce_id = c.req.param('id');

  const [annonce] = await supabaseSelect(c.env, 'coups_de_main', {
    select: 'id,user_id,photo_r2_key',
    commune_id: `eq.${commune_id}`, id: `eq.${annonce_id}`,
  });
  if (!annonce) return c.json({ erreur: 'Annonce introuvable' }, 404);
  if (annonce.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  if (annonce.photo_r2_key) await deleteObject(c.env, annonce.photo_r2_key);
  await supabaseDelete(c.env, 'coups_de_main', { id: `eq.${annonce_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// POST /upload — photo unique (optionnelle) jointe à une annonce, même modération IA que les
// autres points d'upload (voir lib/moderation-image.ts, communes en formule Accompagné/Premium).
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
  if (await photoSuspecte(c.env, commune_id, donnees, contentType)) {
    return c.json({ erreur: 'Cette photo ne respecte pas nos règles de contenu et n\'a pas été acceptée.' }, 422);
  }

  const extension = contentType.split('/')[1];
  const key = `${commune_id}/coups-de-main/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

// POST /:id/interet — exprime un intérêt privé pour une annonce : jamais d'exposition
// publique d'un numéro de téléphone, seul l'auteur de l'annonce voit qui est intéressé et le
// message laissé (voir GET /:id/interets ci-dessous). Une seule fois par personne et par
// annonce (contrainte UNIQUE en base) — pas une question d'XP à farmer, juste pour ne pas
// spammer l'auteur de notifications si quelqu'un re-clique plusieurs fois.
const interetSchema = z.object({ message: z.string().max(500).optional() });

app.post('/:id/interet', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const annonce_id = c.req.param('id');

  const [annonce] = await supabaseSelect(c.env, 'coups_de_main', {
    select: 'id,user_id,titre', commune_id: `eq.${commune_id}`, id: `eq.${annonce_id}`,
  });
  if (!annonce) return c.json({ erreur: 'Annonce introuvable' }, 404);
  if (annonce.user_id === user_id) {
    return c.json({ erreur: 'Vous ne pouvez pas exprimer un intérêt pour votre propre annonce' }, 400);
  }

  const body = interetSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [dejaEnvoye] = await supabaseSelect(c.env, 'coups_de_main_interets', {
    select: 'id', annonce_id: `eq.${annonce_id}`, user_id: `eq.${user_id}`,
  });
  if (dejaEnvoye) return c.json({ erreur: 'Vous avez déjà exprimé votre intérêt pour cette annonce' }, 400);

  await supabaseInsert(c.env, 'coups_de_main_interets', {
    commune_id, annonce_id, user_id, message: body.data.message?.trim() || null,
  });

  c.executionCtx.waitUntil(envoyerNotificationAUtilisateurs(
    c.env, commune_id, [annonce.user_id],
    '🙋 Quelqu\'un est intéressé par votre annonce', annonce.titre,
    `/index.html?onglet=coups-de-main&type=annonce&id=${annonce_id}`,
  ));

  return c.json({ ok: true }, 201);
});

// GET /:id/interets — réservé à l'auteur de l'annonce (ou un gestionnaire) : c'est la seule
// manière de voir qui a exprimé un intérêt et de lire les messages/coordonnées volontairement
// laissés — jamais exposé publiquement, contrairement à l'ancien champ "contact".
app.get('/:id/interets', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const annonce_id = c.req.param('id');

  const [annonce] = await supabaseSelect(c.env, 'coups_de_main', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${annonce_id}`,
  });
  if (!annonce) return c.json({ erreur: 'Annonce introuvable' }, 404);
  if (annonce.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé à l\'auteur de l\'annonce' }, 403);
  }

  const interets = await supabaseSelect(c.env, 'coups_de_main_interets', {
    select: 'id,user_id,message,created_at', commune_id: `eq.${commune_id}`,
    annonce_id: `eq.${annonce_id}`, order: 'created_at.asc',
  });
  if (!interets.length) return c.json({ interets: [] });

  const idsUsers = [...new Set(interets.map((i: any) => i.user_id))];
  const utilisateurs = await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom', commune_id: `eq.${commune_id}`, id: `in.(${idsUsers.join(',')})`,
  });
  const result = interets.map((i: any) => {
    const u = utilisateurs.find((u: any) => u.id === i.user_id);
    return { ...i, prenom: u?.prenom ?? '?', nom: u?.nom ?? '' };
  });

  return c.json({ interets: result });
});

export default app;

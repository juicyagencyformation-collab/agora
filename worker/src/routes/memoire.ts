// worker/src/routes/memoire.ts
// "La mémoire du village" : récits patrimoniaux des habitants (texte + photos + audio).
// Contribution citoyenne → modération standard (signalement → masquage → revue mairie),
// calquée sur le module Énigmes (worker/src/routes/enigmes.ts).
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';
import { attribuerXp, XP_ACTIONS, incrementerCompteurUtilisateur } from '../lib/gamification';

const app = new Hono();
app.use('*', jwtMiddleware);

const THEMES_VALIDES = ['ecole', 'metiers', 'guerre', 'fetes', 'quartier', 'famille', 'commerces', 'autre'] as const;

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const souvenirs = await supabaseSelect(c.env, 'souvenirs', {
    select: 'id,user_id,titre,recit,theme,audio_url,personne_nom,personne_date_naissance,personne_date_deces,created_at',
    commune_id: `eq.${commune_id}`, statut: 'eq.visible', order: 'created_at.desc',
  });
  if (!souvenirs.length) return c.json({ souvenirs: [] });

  const ids = souvenirs.map((s: any) => s.id);
  const idsAuteurs = [...new Set(souvenirs.map((s: any) => s.user_id))];
  const [images, auteurs, mesSignalements] = await Promise.all([
    supabaseSelect(c.env, 'souvenir_images', {
      select: 'souvenir_id,url,ordre', commune_id: `eq.${commune_id}`,
      souvenir_id: `in.(${ids.join(',')})`, order: 'ordre.asc',
    }),
    supabaseSelect(c.env, 'users', {
      select: 'id,prenom,nom', commune_id: `eq.${commune_id}`, id: `in.(${idsAuteurs.join(',')})`,
    }),
    supabaseSelect(c.env, 'souvenir_signalements', {
      select: 'souvenir_id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
      souvenir_id: `in.(${ids.join(',')})`,
    }),
  ]);
  const mesSig = new Set(mesSignalements.map((s: any) => s.souvenir_id));

  const result = souvenirs.map((s: any) => {
    const auteur = auteurs.find((u: any) => u.id === s.user_id);
    return {
      ...s,
      images: images.filter((i: any) => i.souvenir_id === s.id),
      auteur_prenom: auteur?.prenom ?? '?', auteur_nom: auteur?.nom ?? '',
      deja_signale: mesSig.has(s.id), est_moi: s.user_id === user_id,
    };
  });

  return c.json({ souvenirs: result });
});

app.post('/upload-photo', async (c) => {
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    return c.json({ erreur: 'Type de fichier non autorisé (jpeg/png/webp uniquement)' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 8 * 1024 * 1024) return c.json({ erreur: 'Image trop lourde (max 8 Mo)' }, 400);
  const extension = contentType.split('/')[1];
  const key = `${commune_id}/memoire/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

app.post('/upload-audio', async (c) => {
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  // MediaRecorder produit audio/webm (Chrome/Firefox) ou audio/mp4 (Safari/iOS).
  if (!/^audio\/(webm|mp4|mpeg|ogg|wav|aac|x-m4a)$/.test(contentType)) {
    return c.json({ erreur: 'Format audio non autorisé' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 20 * 1024 * 1024) return c.json({ erreur: 'Enregistrement trop lourd (max 20 Mo)' }, 400);
  const extension = contentType.split('/')[1].replace('x-', '');
  const key = `${commune_id}/memoire/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const creationSchema = z.object({
  titre: z.string().min(1).max(150),
  recit: z.string().max(10000).optional(),
  theme: z.enum(THEMES_VALIDES).default('autre'),
  image_r2_keys: z.array(z.string()).max(10).optional(),
  audio_r2_key: z.string().max(300).optional(),
  // Thème "famille" : la personne représentée par ce souvenir (portrait = 1re photo),
  // pour la frise chronologique des ancêtres — tous optionnels, une histoire de famille
  // n'a pas forcément besoin de dates précises.
  personne_nom: z.string().max(100).optional(),
  personne_date_naissance: z.string().regex(DATE_REGEX).optional(),
  personne_date_deces: z.string().regex(DATE_REGEX).optional(),
}).refine((d) => !!d.recit?.trim() || !!d.audio_r2_key, {
  message: 'Ajoute un récit écrit ou un enregistrement audio.',
});

app.post('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [souvenir] = await supabaseInsert(c.env, 'souvenirs', {
    commune_id, user_id, titre: data.titre, recit: data.recit?.trim() || null, theme: data.theme,
    audio_url: data.audio_r2_key ? `${c.env.R2_PUBLIC_BASE}/${data.audio_r2_key}` : null,
    audio_r2_key: data.audio_r2_key || null, statut: 'visible',
    personne_nom: data.personne_nom?.trim() || null,
    personne_date_naissance: data.personne_date_naissance || null,
    personne_date_deces: data.personne_date_deces || null,
  });

  if (data.image_r2_keys?.length) {
    await supabaseInsert(c.env, 'souvenir_images', data.image_r2_keys.map((key, i) => ({
      commune_id, souvenir_id: souvenir.id, r2_key: key,
      url: `${c.env.R2_PUBLIC_BASE}/${key}`, ordre: i,
    })));
  }

  // Pas d'XP à la création : supprimer/recréer permettrait sinon de farmer à l'infini
  // (même logique que le module Énigmes).
  return c.json({ souvenir_id: souvenir.id }, 201);
});

const editionSchema = z.object({
  titre: z.string().min(1).max(150).optional(),
  recit: z.string().max(10000).optional(),
  theme: z.enum(THEMES_VALIDES).optional(),
  personne_nom: z.string().max(100).optional(),
  personne_date_naissance: z.string().regex(DATE_REGEX).optional(),
  personne_date_deces: z.string().regex(DATE_REGEX).optional(),
});

app.patch('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const souvenir_id = c.req.param('id');

  const [souvenir] = await supabaseSelect(c.env, 'souvenirs', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${souvenir_id}`,
  });
  if (!souvenir) return c.json({ erreur: 'Souvenir introuvable' }, 404);
  if (souvenir.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Vous ne pouvez modifier que vos propres souvenirs' }, 403);
  }

  const body = editionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const patch: Record<string, unknown> = {};
  if (data.titre) patch.titre = data.titre;
  if (data.recit !== undefined) patch.recit = data.recit.trim() || null;
  if (data.theme) patch.theme = data.theme;
  if (data.personne_nom !== undefined) patch.personne_nom = data.personne_nom.trim() || null;
  if (data.personne_date_naissance !== undefined) patch.personne_date_naissance = data.personne_date_naissance;
  if (data.personne_date_deces !== undefined) patch.personne_date_deces = data.personne_date_deces;
  if (Object.keys(patch).length === 0) return c.json({ erreur: 'Aucun champ à modifier' }, 400);

  await supabaseUpdate(c.env, 'souvenirs', patch, { id: `eq.${souvenir_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// Un seul signalement masque le souvenir en attendant la revue mairie (règle 4).
app.post('/:id/signaler', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const souvenir_id = c.req.param('id');

  const [souvenir] = await supabaseSelect(c.env, 'souvenirs', {
    select: 'id', commune_id: `eq.${commune_id}`, id: `eq.${souvenir_id}`,
  });
  if (!souvenir) return c.json({ erreur: 'Souvenir introuvable' }, 404);

  const [existant] = await supabaseSelect(c.env, 'souvenir_signalements', {
    select: 'id', commune_id: `eq.${commune_id}`, souvenir_id: `eq.${souvenir_id}`, user_id: `eq.${user_id}`,
  });
  if (!existant) await supabaseInsert(c.env, 'souvenir_signalements', { commune_id, souvenir_id, user_id });
  await supabaseUpdate(c.env, 'souvenirs', { statut: 'masquee' }, {
    id: `eq.${souvenir_id}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

// GET /moderation/en-attente — file de revue des souvenirs masqués (gestionnaires uniquement).
app.get('/moderation/en-attente', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const souvenirs = await supabaseSelect(c.env, 'souvenirs', {
    select: 'id,user_id,titre,recit,theme,created_at',
    commune_id: `eq.${commune_id}`, statut: 'eq.masquee', order: 'created_at.desc',
  });
  if (!souvenirs.length) return c.json({ souvenirs: [] });

  const ids = souvenirs.map((s: any) => s.id);
  const signalements = await supabaseSelect(c.env, 'souvenir_signalements', {
    select: 'souvenir_id', commune_id: `eq.${commune_id}`, souvenir_id: `in.(${ids.join(',')})`,
  });
  const result = souvenirs.map((s: any) => ({
    ...s, total_signalements: signalements.filter((x: any) => x.souvenir_id === s.id).length,
  }));
  return c.json({ souvenirs: result });
});

app.patch('/:id/restaurer', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseUpdate(c.env, 'souvenirs', { statut: 'visible' }, {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const souvenir_id = c.req.param('id');

  const [souvenir] = await supabaseSelect(c.env, 'souvenirs', {
    select: 'id,user_id,audio_r2_key,statut', commune_id: `eq.${commune_id}`, id: `eq.${souvenir_id}`,
  });
  if (!souvenir) return c.json({ erreur: 'Souvenir introuvable' }, 404);
  if (souvenir.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  // Signalement fondé (suppression d'un souvenir masqué) : on récompense chaque signaleur,
  // compteur + XP partagés avec les autres modules (badge "Protecteur du village").
  if (souvenir.statut === 'masquee') {
    const signalements = await supabaseSelect(c.env, 'souvenir_signalements', {
      select: 'user_id', commune_id: `eq.${commune_id}`, souvenir_id: `eq.${souvenir_id}`,
    });
    for (const s of signalements) {
      await incrementerCompteurUtilisateur(c.env, commune_id, s.user_id, 'signalements_confirmes');
      await attribuerXp(c.env, commune_id, s.user_id, XP_ACTIONS.signalement_confirme);
    }
  }

  // Suppression des objets R2 (les lignes images/signalements partent en cascade via FK).
  const images = await supabaseSelect(c.env, 'souvenir_images', {
    select: 'r2_key', commune_id: `eq.${commune_id}`, souvenir_id: `eq.${souvenir_id}`,
  });
  await Promise.all(images.map((img: any) => deleteObject(c.env, img.r2_key)));
  if (souvenir.audio_r2_key) await deleteObject(c.env, souvenir.audio_r2_key);

  await supabaseDelete(c.env, 'souvenirs', { id: `eq.${souvenir_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

export default app;

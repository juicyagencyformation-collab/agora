// worker/src/routes/photo_du_jour.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';
import { attribuerXp, XP_ACTIONS, incrementerCompteurUtilisateur } from '../lib/gamification';

const app = new Hono();
app.use('*', jwtMiddleware);

function dateDuJourUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function seuilAffichagePourDuree(duree: string): string {
  const jours = duree === 'jour' ? 1 : duree === 'mois' ? 30 : 7; // 'semaine' par défaut
  const seuil = new Date(Date.now() - jours * 24 * 3600 * 1000);
  return seuil.toISOString().slice(0, 10);
}

// GET / — galerie de la semaine en cours (remise à zéro chaque lundi par le cron)
app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'photo_jour_seuil_validations,photo_jour_max_par_jour,photo_jour_duree', id: `eq.${commune_id}`,
  });
  const seuil = commune?.photo_jour_seuil_validations ?? 6;
  const maxParJour = commune?.photo_jour_max_par_jour ?? 1;
  const duree = commune?.photo_jour_duree ?? 'semaine';

  const photos = await supabaseSelect(c.env, 'photos_du_jour', {
    select: 'id,user_id,url,date_publication,created_at,libre_de_droit,force_deflout',
    commune_id: `eq.${commune_id}`,
    statut: 'eq.visible',
    date_publication: `gte.${seuilAffichagePourDuree(duree)}`,
    order: 'created_at.desc',
  });

  const ids = photos.map((p: any) => p.id);
  const [validations, mesSignalements, likes] = await Promise.all([
    ids.length ? supabaseSelect(c.env, 'photo_validations', {
      select: 'photo_id,user_id',
      commune_id: `eq.${commune_id}`,
      photo_id: `in.(${ids.join(',')})`,
    }) : [],
    ids.length ? supabaseSelect(c.env, 'photo_signalements', {
      select: 'photo_id',
      commune_id: `eq.${commune_id}`,
      photo_id: `in.(${ids.join(',')})`,
      user_id: `eq.${user_id}`,
    }) : [],
    ids.length ? supabaseSelect(c.env, 'photo_likes', {
      select: 'photo_id,user_id',
      commune_id: `eq.${commune_id}`,
      photo_id: `in.(${ids.join(',')})`,
    }) : [],
  ]);

  const mesPhotosSignalees = new Set(mesSignalements.map((s: any) => s.photo_id));
  const registreAujourdhui = await supabaseSelect(c.env, 'photo_jour_publications', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, date_publication: `eq.${dateDuJourUTC()}`,
  });
  const publicationsAujourdhui = registreAujourdhui.length;

  const result = photos.map((p: any) => {
    const validationsPhoto = validations.filter((v: any) => v.photo_id === p.id);
    const likesPhoto = likes.filter((l: any) => l.photo_id === p.id);
    return {
      ...p,
      est_moi: p.user_id === user_id,
      total_validations: validationsPhoto.length,
      seuil_validations: seuil,
      deja_valide: validationsPhoto.some((v: any) => v.user_id === user_id),
      deja_signale: mesPhotosSignalees.has(p.id),
      total_likes: likesPhoto.length,
      deja_like: likesPhoto.some((l: any) => l.user_id === user_id),
    };
  });

  return c.json({
    photos: result,
    publications_aujourdhui: publicationsAujourdhui,
    max_par_jour: maxParJour,
    deja_publiee_aujourdhui: publicationsAujourdhui >= maxParJour,
  });
});

// GET /vedette — la photo la plus aimée de la semaine parmi celles marquées "libre de droit"
// (utilisée sur le dashboard d'accueil, jamais une photo sans consentement explicite à la mise en avant)
app.get('/vedette', async (c) => {
  const commune_id = c.get('commune_id');

  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'photo_jour_duree', id: `eq.${commune_id}`,
  });
  const duree = commune?.photo_jour_duree ?? 'semaine';

  const photos = await supabaseSelect(c.env, 'photos_du_jour', {
    select: 'id,url,user_id',
    commune_id: `eq.${commune_id}`,
    statut: 'eq.visible',
    libre_de_droit: 'eq.true',
    date_publication: `gte.${seuilAffichagePourDuree(duree)}`,
  });
  if (!photos.length) return c.json({ vedette: null });

  const ids = photos.map((p: any) => p.id);
  const likes = await supabaseSelect(c.env, 'photo_likes', {
    select: 'photo_id', commune_id: `eq.${commune_id}`, photo_id: `in.(${ids.join(',')})`,
  });

  let meilleure: any = null;
  let meilleurScore = -1;
  for (const p of photos) {
    const score = likes.filter((l: any) => l.photo_id === p.id).length;
    if (score > meilleurScore) { meilleurScore = score; meilleure = p; }
  }
  if (meilleurScore <= 0) return c.json({ vedette: null }); // pas de photo mise en avant sans au moins 1 like

  return c.json({ vedette: { id: meilleure.id, url: meilleure.url, total_likes: meilleurScore } });
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
  const key = `${commune_id}/photo-du-jour/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

const creationSchema = z.object({
  r2_key: z.string().min(1),
  libre_de_droit: z.boolean().default(false),
});

app.post('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const aujourdhui = dateDuJourUTC();
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'photo_jour_max_par_jour', id: `eq.${commune_id}`,
  });
  const maxParJour = commune?.photo_jour_max_par_jour ?? 1;

  const publicationsAujourdhui = await supabaseSelect(c.env, 'photo_jour_publications', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, date_publication: `eq.${aujourdhui}`,
  });
  if (publicationsAujourdhui.length >= maxParJour) {
    return c.json({ erreur: `Vous avez déjà publié le maximum de photos autorisées aujourd'hui (${maxParJour})` }, 400);
  }

  const [photo] = await supabaseInsert(c.env, 'photos_du_jour', {
    commune_id, user_id, r2_key: body.data.r2_key,
    url: `${c.env.R2_PUBLIC_BASE}/${body.data.r2_key}`,
    date_publication: aujourdhui, statut: 'visible', libre_de_droit: body.data.libre_de_droit,
  });
  // Registre permanent, jamais supprimé même si la photo l'est — empêche de contourner
  // la limite quotidienne en supprimant puis republiant. Aucune XP à la création (même raison).
  await supabaseInsert(c.env, 'photo_jour_publications', { commune_id, user_id, date_publication: aujourdhui });

  return c.json({ photo_id: photo.id }, 201);
});

// Le propriétaire peut changer le statut "libre de droit" de sa propre photo à tout moment
// (ex: il ne voulait pas au départ qu'elle soit éligible à la mise en avant, et change d'avis).
app.patch('/:id/libre-de-droit', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const id = c.req.param('id');

  const body = z.object({ libre_de_droit: z.boolean() }).safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [photo] = await supabaseSelect(c.env, 'photos_du_jour', {
    select: 'id,user_id', id: `eq.${id}`, commune_id: `eq.${commune_id}`,
  });
  if (!photo) return c.json({ erreur: 'Photo introuvable' }, 404);
  if (photo.user_id !== user_id) return c.json({ erreur: 'Vous ne pouvez modifier que vos propres photos' }, 403);

  await supabaseUpdate(c.env, 'photos_du_jour', { libre_de_droit: body.data.libre_de_droit }, {
    id: `eq.${id}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
});

app.post('/:id/valider', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const photo_id = c.req.param('id');

  const [photo] = await supabaseSelect(c.env, 'photos_du_jour', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${photo_id}`,
  });
  if (!photo) return c.json({ erreur: 'Photo introuvable' }, 404);
  if (photo.user_id === user_id) return c.json({ erreur: 'Vous ne pouvez pas valider votre propre photo' }, 400);

  const [existante] = await supabaseSelect(c.env, 'photo_validations', {
    select: 'id', commune_id: `eq.${commune_id}`, photo_id: `eq.${photo_id}`, user_id: `eq.${user_id}`,
  });
  if (existante) return c.json({ erreur: 'Déjà validée' }, 400);

  await supabaseInsert(c.env, 'photo_validations', { commune_id, photo_id, user_id });
  await incrementerCompteurUtilisateur(c.env, commune_id, user_id, 'validations_donnees');
  const resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.valider_photo);
  return c.json({ ok: true, ...resultatXp });
});

// POST /:id/liker — toggle like (indépendant de la validation, purement appréciation)
app.post('/:id/liker', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const photo_id = c.req.param('id');

  const [existant] = await supabaseSelect(c.env, 'photo_likes', {
    select: 'id', commune_id: `eq.${commune_id}`, photo_id: `eq.${photo_id}`, user_id: `eq.${user_id}`,
  });
  if (existant) {
    await supabaseDelete(c.env, 'photo_likes', { id: `eq.${existant.id}` });
    return c.json({ ok: true, action: 'retire' });
  }
  await supabaseInsert(c.env, 'photo_likes', { commune_id, photo_id, user_id });
  return c.json({ ok: true, action: 'ajoute' });
});

// PATCH /:id/deflouter — un gestionnaire peut rendre une photo nette immédiatement,
// sans attendre les validations citoyennes (utile pour la modération ou les tests).
app.patch('/:id/deflouter', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseUpdate(c.env, 'photos_du_jour', { force_deflout: true }, {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

// Un seul signalement suffit à masquer la photo, le temps qu'un gestionnaire tranche.
app.post('/:id/signaler', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const photo_id = c.req.param('id');

  const [photo] = await supabaseSelect(c.env, 'photos_du_jour', {
    select: 'id', commune_id: `eq.${commune_id}`, id: `eq.${photo_id}`,
  });
  if (!photo) return c.json({ erreur: 'Photo introuvable' }, 404);

  const [existant] = await supabaseSelect(c.env, 'photo_signalements', {
    select: 'id', commune_id: `eq.${commune_id}`, photo_id: `eq.${photo_id}`, user_id: `eq.${user_id}`,
  });
  if (!existant) {
    await supabaseInsert(c.env, 'photo_signalements', { commune_id, photo_id, user_id });
  }
  await supabaseUpdate(c.env, 'photos_du_jour', { statut: 'masquee' }, {
    id: `eq.${photo_id}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
});

// GET /moderation/en-attente — file de revue des photos masquées (gestionnaires uniquement)
app.get('/moderation/en-attente', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const photos = await supabaseSelect(c.env, 'photos_du_jour', {
    select: 'id,user_id,url,date_publication,created_at',
    commune_id: `eq.${commune_id}`, statut: 'eq.masquee',
    order: 'created_at.desc',
  });
  const ids = photos.map((p: any) => p.id);
  const signalements = ids.length ? await supabaseSelect(c.env, 'photo_signalements', {
    select: 'photo_id', commune_id: `eq.${commune_id}`, photo_id: `in.(${ids.join(',')})`,
  }) : [];

  const result = photos.map((p: any) => ({
    ...p,
    total_signalements: signalements.filter((s: any) => s.photo_id === p.id).length,
  }));

  return c.json({ photos: result });
});

app.patch('/:id/restaurer', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseUpdate(c.env, 'photos_du_jour', { statut: 'visible' }, {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const photo_id = c.req.param('id');

  const [photo] = await supabaseSelect(c.env, 'photos_du_jour', {
    select: 'id,user_id,r2_key,statut', commune_id: `eq.${commune_id}`, id: `eq.${photo_id}`,
  });
  if (!photo) return c.json({ erreur: 'Photo introuvable' }, 404);
  if (photo.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  // La photo était signalée puis effectivement supprimée : le(s) signalement(s) étaient fondés —
  // on récompense chaque personne qui l'avait signalée (XP + progression vers le badge "Protecteur").
  if (photo.statut === 'masquee') {
    const signalements = await supabaseSelect(c.env, 'photo_signalements', {
      select: 'user_id', commune_id: `eq.${commune_id}`, photo_id: `eq.${photo_id}`,
    });
    for (const s of signalements) {
      await incrementerCompteurUtilisateur(c.env, commune_id, s.user_id, 'signalements_confirmes');
      await attribuerXp(c.env, commune_id, s.user_id, XP_ACTIONS.signalement_confirme);
    }
  }

  await deleteObject(c.env, photo.r2_key);
  await supabaseDelete(c.env, 'photos_du_jour', { id: `eq.${photo_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

export default app;

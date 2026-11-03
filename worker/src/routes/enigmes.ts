// worker/src/routes/enigmes.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';
import { attribuerXp, XP_ACTIONS, incrementerCompteurUtilisateur, gererStreakExploration } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';
import { distanceMetres } from '../lib/geo';
import { photoSuspecte } from '../lib/moderation-image';

const app = new Hono();
app.use('*', jwtMiddleware);

// Distance à vol d'oiseau entre deux points GPS (formule de Haversine), en mètres.
// Distance à vol d'oiseau importée depuis lib/geo.ts (voir plus haut)

// GET / — IMPORTANT : lat/lng ne sont JAMAIS renvoyées tant que l'énigme n'est pas résolue par
// la personne qui consulte (ni pour les autres joueurs). Les envoyer permettrait de lire la
// position directe dans la réponse réseau (F12) et de contourner tout le jeu.
app.get('/', async (c) => {
  return c.json({ enigmes: await listerEnigmesJouables(c.env, c.get('commune_id'), c.get('user_id')) });
});

// Partagé avec routes/jeux_ailleurs.ts (joueur venu d'une autre commune) : une seule projection,
// donc un seul endroit où garantir que lat/lng ne sortent jamais avant résolution.
export async function listerEnigmesJouables(env: any, commune_id: string, user_id: string) {
  const enigmes = await supabaseSelect(env, 'photos_enigmes', {
    select: 'id,user_id,url,indice,lat,lng,created_at',
    commune_id: `eq.${commune_id}`,
    statut: 'eq.active',
    order: 'created_at.desc',
  });

  const ids = enigmes.map((e: any) => e.id);
  const [reussites, mesSignalements] = await Promise.all([
    ids.length ? supabaseSelect(env, 'enigme_reussites', {
      select: 'enigme_id,user_id,distance_metres',
      commune_id: `eq.${commune_id}`,
      enigme_id: `in.(${ids.join(',')})`,
    }) : [],
    ids.length ? supabaseSelect(env, 'enigme_signalements', {
      select: 'enigme_id',
      commune_id: `eq.${commune_id}`,
      enigme_id: `in.(${ids.join(',')})`,
      user_id: `eq.${user_id}`,
    }) : [],
  ]);
  const mesEnigmesSignalees = new Set(mesSignalements.map((s: any) => s.enigme_id));

  return enigmes.map((e: any) => {
    const estMoi = e.user_id === user_id;
    const maReussite = reussites.find((r: any) => r.enigme_id === e.id && r.user_id === user_id);
    const total_trouveurs = reussites.filter((r: any) => r.enigme_id === e.id).length;
    const deja_trouve = !!maReussite;

    return {
      id: e.id,
      user_id: e.user_id,
      url: e.url,
      indice: e.indice,
      created_at: e.created_at,
      est_moi: estMoi,
      deja_trouve,
      total_trouveurs,
      deja_signale: mesEnigmesSignalees.has(e.id),
      // lat/lng révélées uniquement si déjà trouvée ou si c'est sa propre énigme
      ...(deja_trouve || estMoi ? { lat: e.lat, lng: e.lng } : {}),
      ...(deja_trouve ? { distance_metres: Math.round(maReussite.distance_metres) } : {}),
    };
  });
}

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
  const key = `${commune_id}/enigmes/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

const creationSchema = z.object({
  r2_key: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  indice: z.string().max(200).optional(),
});

app.post('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [enigme] = await supabaseInsert(c.env, 'photos_enigmes', {
    commune_id, user_id, r2_key: data.r2_key,
    url: `${c.env.R2_PUBLIC_BASE}/${data.r2_key}`,
    lat: data.lat, lng: data.lng, indice: data.indice ?? null, statut: 'active',
  });

  // Aucune XP à la création : supprimer puis recréer permettrait sinon de farmer à l'infini
  // avec un seul compte. Le streak reste comptabilisé (déjà limité à 1 fois/jour, non exploitable).
  await gererStreakExploration(c.env, commune_id, user_id);

  c.executionCtx.waitUntil((async () => {
    const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_enigmes');
    await envoyerNotificationAUtilisateurs(
      c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
      '🧭 Nouvelle énigme à trouver', data.indice || 'Une nouvelle photo vous attend !', `/index.html?onglet=chasse-tresor&type=enigme&id=${enigme.id}`,
    );
  })());

  return c.json({ enigme_id: enigme.id }, 201);
});

export const validationEnigmeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

app.post('/:id/valider', async (c) => {
  const commune_id = c.get('commune_id');
  const body = validationEnigmeSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  return validerEnigme(c, commune_id, commune_id, c.get('user_id'), c.req.param('id'), body.data);
});

// Partagé avec routes/jeux_ailleurs.ts. commune_id = celle de l'énigme (réussite enregistrée
// chez elle, rayon de validation choisi par elle), commune_joueur = celle du compte (XP,
// compteurs, badges) — identiques pour un habitant qui joue chez lui.
export async function validerEnigme(c: any, commune_id: string, commune_joueur: string, user_id: string, enigme_id: string, position: z.infer<typeof validationEnigmeSchema>) {
  const [enigme] = await supabaseSelect(c.env, 'photos_enigmes', {
    select: 'id,user_id,lat,lng', commune_id: `eq.${commune_id}`, id: `eq.${enigme_id}`, statut: 'eq.active',
  });
  if (!enigme) return c.json({ erreur: 'Énigme introuvable' }, 404);
  if (enigme.user_id === user_id) {
    return c.json({ erreur: 'Vous ne pouvez pas résoudre votre propre énigme' }, 400);
  }

  const [dejaTrouve] = await supabaseSelect(c.env, 'enigme_reussites', {
    select: 'id', commune_id: `eq.${commune_id}`, enigme_id: `eq.${enigme_id}`, user_id: `eq.${user_id}`,
  });
  if (dejaTrouve) return c.json({ erreur: 'Déjà trouvée' }, 400);

  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'rayon_validation_enigme', id: `eq.${commune_id}`,
  });
  const rayon = commune?.rayon_validation_enigme ?? 40;

  const distance = distanceMetres(position.lat, position.lng, enigme.lat, enigme.lng);

  if (distance > rayon) {
    return c.json({ ok: true, reussi: false, distance_metres: Math.round(distance) });
  }

  await supabaseInsert(c.env, 'enigme_reussites', {
    commune_id, enigme_id, user_id, distance_metres: distance,
  });
  await incrementerCompteurUtilisateur(c.env, commune_joueur, user_id, 'enigmes_trouvees');
  await gererStreakExploration(c.env, commune_joueur, user_id);
  const resultatXp = await attribuerXp(c.env, commune_joueur, user_id, XP_ACTIONS.trouver_enigme);

  return c.json({
    ok: true, reussi: true, distance_metres: Math.round(distance),
    ...resultatXp,
  });
}

// Un seul signalement suffit à masquer l'énigme, le temps qu'un gestionnaire tranche —
// exactement le même principe de protection que sur Photo du jour.
app.post('/:id/signaler', async (c) => {
  return signalerEnigme(c, c.get('commune_id'), c.get('user_id'), c.req.param('id'));
});

// Partagé avec routes/jeux_ailleurs.ts : un joueur venu d'ailleurs doit pouvoir signaler une
// photo choquante comme n'importe qui (règle n°4, signalement → masquage immédiat → revue mairie).
export async function signalerEnigme(c: any, commune_id: string, user_id: string, enigme_id: string) {
  const [enigme] = await supabaseSelect(c.env, 'photos_enigmes', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${enigme_id}`,
  });
  if (!enigme) return c.json({ erreur: 'Énigme introuvable' }, 404);
  // Anti-farming : sans ce blocage, se signaler puis se supprimer soi-même (voir DELETE /:id,
  // qui récompense chaque signaleur d'une énigme "masquée" au moment de sa suppression) offrait
  // de l'XP gratuit et illimité — créer une énigme, se signaler, se supprimer, répéter.
  if (enigme.user_id === user_id) {
    return c.json({ erreur: 'Vous ne pouvez pas signaler votre propre énigme' }, 400);
  }

  const [existant] = await supabaseSelect(c.env, 'enigme_signalements', {
    select: 'id', commune_id: `eq.${commune_id}`, enigme_id: `eq.${enigme_id}`, user_id: `eq.${user_id}`,
  });
  if (!existant) {
    await supabaseInsert(c.env, 'enigme_signalements', { commune_id, enigme_id, user_id });
  }
  await supabaseUpdate(c.env, 'photos_enigmes', { statut: 'masquee' }, {
    id: `eq.${enigme_id}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
}

// GET /moderation/en-attente — file de revue des énigmes masquées (gestionnaires uniquement)
app.get('/moderation/en-attente', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const enigmes = await supabaseSelect(c.env, 'photos_enigmes', {
    select: 'id,user_id,url,created_at',
    commune_id: `eq.${commune_id}`, statut: 'eq.masquee',
    order: 'created_at.desc',
  });
  const ids = enigmes.map((e: any) => e.id);
  const signalements = ids.length ? await supabaseSelect(c.env, 'enigme_signalements', {
    select: 'enigme_id', commune_id: `eq.${commune_id}`, enigme_id: `in.(${ids.join(',')})`,
  }) : [];

  const result = enigmes.map((e: any) => ({
    ...e,
    total_signalements: signalements.filter((s: any) => s.enigme_id === e.id).length,
  }));

  return c.json({ enigmes: result });
});

app.patch('/:id/restaurer', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseUpdate(c.env, 'photos_enigmes', { statut: 'active' }, {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const enigme_id = c.req.param('id');

  const [enigme] = await supabaseSelect(c.env, 'photos_enigmes', {
    select: 'id,user_id,r2_key,statut', commune_id: `eq.${commune_id}`, id: `eq.${enigme_id}`,
  });
  if (!enigme) return c.json({ erreur: 'Énigme introuvable' }, 404);
  if (enigme.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  // Signalement fondé : on récompense chaque signaleur (compteur + XP partagés avec Photo du jour,
  // un seul badge "Protecteur du village" pour toute contribution à la sécurité de l'app).
  if (enigme.statut === 'masquee') {
    const signalements = await supabaseSelect(c.env, 'enigme_signalements', {
      select: 'user_id', commune_id: `eq.${commune_id}`, enigme_id: `eq.${enigme_id}`,
    });
    for (const s of signalements) {
      await incrementerCompteurUtilisateur(c.env, commune_id, s.user_id, 'signalements_confirmes');
      await attribuerXp(c.env, commune_id, s.user_id, XP_ACTIONS.signalement_confirme);
    }
  }

  await deleteObject(c.env, enigme.r2_key);
  await supabaseDelete(c.env, 'photos_enigmes', { id: `eq.${enigme_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

export default app;

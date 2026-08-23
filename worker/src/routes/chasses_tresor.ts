// worker/src/routes/chasses_tresor.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier } from '../storage';
import { genererQrSvg } from '../lib/qrcode';
import { distanceMetres } from '../lib/geo';
import { attribuerXp, XP_ACTIONS, incrementerCompteurUtilisateur, gererStreakExploration } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';

const app = new Hono();
app.use('*', jwtMiddleware);

const TYPES_CONTENU_ETAPE = ['aucun', 'texte', 'photo', 'enigme'] as const;

// Normalisation souple des réponses d'énigme : casse, accents et espaces multiples ignorés.
function normaliserReponse(texte: string): string {
  return texte.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

const etapeSchema = z.object({
  titre: z.string().min(1).max(150),
  indice: z.string().min(1).max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  type_contenu: z.enum(TYPES_CONTENU_ETAPE).default('aucun'),
  contenu: z.string().max(2000).optional(),
  photo_r2_key: z.string().max(300).optional(),
  enigme_reponse: z.string().max(200).optional(),
})
  .refine((e) => e.type_contenu !== 'texte' || !!e.contenu?.trim(), { message: 'Le texte descriptif est requis.' })
  .refine((e) => e.type_contenu !== 'photo' || !!e.photo_r2_key, { message: 'La photo est requise.' })
  .refine((e) => e.type_contenu !== 'enigme' || (!!e.contenu?.trim() && !!e.enigme_reponse?.trim()), {
    message: 'Une énigme requiert une question et une réponse.',
  });
const creationChasseSchema = z.object({
  titre: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  mode: z.enum(['chasse', 'balade']).default('chasse'),
  rayon_metres: z.number().int().min(20).max(500).default(50),
  etapes: z.array(etapeSchema).min(1).max(20),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const chasses = await supabaseSelect(c.env, 'chasses_tresor', {
    select: 'id,titre,description,actif,mode,rayon_metres,created_at',
    commune_id: `eq.${commune_id}`,
    actif: 'eq.true',
    order: 'created_at.desc',
  });
  const ids = chasses.map((ch: any) => ch.id);
  if (!ids.length) return c.json({ chasses: [] });

  const [etapes, progressions] = await Promise.all([
    supabaseSelect(c.env, 'etapes_chasse', {
      select: 'id,chasse_id,ordre,titre,indice,lat,lng,type_contenu',
      commune_id: `eq.${commune_id}`,
      chasse_id: `in.(${ids.join(',')})`,
      order: 'ordre.asc',
    }),
    supabaseSelect(c.env, 'progressions_chasse', {
      select: 'chasse_id,etape_id,user_id,validee_at',
      commune_id: `eq.${commune_id}`,
      chasse_id: `in.(${ids.join(',')})`,
      user_id: `eq.${user_id}`,
    }),
  ]);

  const result = chasses.map((ch: any) => {
    const etapesChasse = etapes.filter((e: any) => e.chasse_id === ch.id);
    const etapesValidees = progressions.filter((p: any) => p.chasse_id === ch.id).map((p: any) => p.etape_id);
    const base: any = {
      ...ch,
      total_etapes: etapesChasse.length,
      etapes_validees: etapesValidees.length,
      etape_suivante: etapesChasse.find((e: any) => !etapesValidees.includes(e.id)) ?? null,
    };
    // En mode balade, on expose toute la liste des points (coordonnées) pour tracer la
    // carte et l'itinéraire ; en mode chasse, on garde le secret (seul l'indice suivant).
    if (ch.mode === 'balade') {
      base.etapes = etapesChasse.map((e: any) => ({
        id: e.id, ordre: e.ordre, titre: e.titre, indice: e.indice,
        lat: e.lat, lng: e.lng, type_contenu: e.type_contenu,
        validee: etapesValidees.includes(e.id),
      }));
    }
    return base;
  });

  return c.json({ chasses: result });
});

app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationChasseSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [chasse] = await supabaseInsert(c.env, 'chasses_tresor', {
    commune_id, user_id, titre: data.titre, description: data.description ?? null, actif: true,
    mode: data.mode, rayon_metres: data.rayon_metres,
  });

  await supabaseInsert(c.env, 'etapes_chasse', data.etapes.map((e, i) => ({
    commune_id, chasse_id: chasse.id, ordre: i, titre: e.titre, indice: e.indice,
    lat: e.lat, lng: e.lng, qr_token: crypto.randomUUID(),
    type_contenu: e.type_contenu,
    contenu: e.contenu?.trim() || null,
    photo_url: e.photo_r2_key ? `${c.env.R2_PUBLIC_BASE}/${e.photo_r2_key}` : null,
    photo_r2_key: e.photo_r2_key || null,
    enigme_reponse: e.type_contenu === 'enigme' ? (e.enigme_reponse?.trim() || null) : null,
  })));

  c.executionCtx.waitUntil((async () => {
    const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_chasses');
    await envoyerNotificationAUtilisateurs(
      c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
      '🗺️ Nouvelle chasse au trésor', data.titre, `/index.html?onglet=chasse-tresor&type=chasse&id=${chasse.id}`,
    );
  })());

  return c.json({ chasse_id: chasse.id }, 201);
});

// GET /:id/etapes — liste des étapes avec leurs identifiants (gestionnaire, pour générer/imprimer les QR)
app.get('/:id/etapes', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const etapes = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id,ordre,titre,indice',
    commune_id: `eq.${commune_id}`, chasse_id: `eq.${c.req.param('id')}`,
    order: 'ordre.asc',
  });
  return c.json({ etapes });
});

app.get('/:id/etapes/:etapeId/qr-page', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'qr_token',
    commune_id: `eq.${commune_id}`, id: `eq.${c.req.param('etapeId')}`,
  });
  if (!etape) return c.json({ erreur: 'Étape introuvable' }, 404);

  const svg = genererQrSvg(etape.qr_token);
  return c.html(`<div>${svg}<p style="font-family:monospace">${etape.qr_token}</p></div>`);
});

// POST /upload-photo — image d'une étape (type 'photo'), gestionnaire uniquement.
app.post('/upload-photo', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
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
  const key = `${commune_id}/chasses/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

// Logique commune de validation d'une étape, quel que soit le déclencheur (scan QR ou
// proximité GPS d'une balade) : contrôle de l'ordre, anti-doublon, énigme, progression,
// XP et contenu révélé. Renvoie directement la réponse JSON.
async function finaliserValidationEtape(c: any, commune_id: string, user_id: string, etape: any, reponse?: string) {
  if (etape.ordre > 0) {
    const etapesPrecedentes = await supabaseSelect(c.env, 'etapes_chasse', {
      select: 'id',
      commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, ordre: `lt.${etape.ordre}`,
    });
    const progressions = await supabaseSelect(c.env, 'progressions_chasse', {
      select: 'etape_id',
      commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, user_id: `eq.${user_id}`,
    });
    const idsValides = progressions.map((p: any) => p.etape_id);
    const toutesValidees = etapesPrecedentes.every((e: any) => idsValides.includes(e.id));
    if (!toutesValidees) return c.json({ erreur: 'Étapes précédentes non validées' }, 400);
  }

  const [dejaValidee] = await supabaseSelect(c.env, 'progressions_chasse', {
    select: 'id',
    commune_id: `eq.${commune_id}`, etape_id: `eq.${etape.id}`, user_id: `eq.${user_id}`,
  });
  if (dejaValidee) return c.json({ erreur: 'Étape déjà validée' }, 400);

  // Énigme : on renvoie d'abord la question (sans valider) ; l'étape n'est validée que
  // sur une bonne réponse. La réponse attendue n'est JAMAIS renvoyée au client.
  if (etape.type_contenu === 'enigme') {
    const reponseSaisie = (reponse ?? '').trim();
    if (!reponseSaisie) {
      return c.json({ ok: true, etape_enigme: true, question: etape.contenu });
    }
    if (normaliserReponse(reponseSaisie) !== normaliserReponse(etape.enigme_reponse ?? '')) {
      return c.json({ erreur: 'Mauvaise réponse, réessaie.' }, 400);
    }
  }

  await supabaseInsert(c.env, 'progressions_chasse', {
    commune_id, chasse_id: etape.chasse_id, etape_id: etape.id, user_id, validee_at: new Date().toISOString(),
  });

  await incrementerCompteurUtilisateur(c.env, commune_id, user_id, 'etapes_chasse_validees');

  // Détecte la complétion à 100% de CETTE chasse (badge "Finisseur", distinct du simple cumul).
  const toutesEtapesChasse = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id', commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`,
  });
  const mesProgressionsChasse = await supabaseSelect(c.env, 'progressions_chasse', {
    select: 'id', commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, user_id: `eq.${user_id}`,
  });
  if (mesProgressionsChasse.length >= toutesEtapesChasse.length) {
    await incrementerCompteurUtilisateur(c.env, commune_id, user_id, 'chasses_terminees');
  }

  await gererStreakExploration(c.env, commune_id, user_id);
  const resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.valider_etape_chasse);

  // Contenu à révéler côté joueur une fois l'étape validée (texte ou photo).
  let contenu_revele: { type: string; texte?: string; photo_url?: string } | null = null;
  if (etape.type_contenu === 'texte') contenu_revele = { type: 'texte', texte: etape.contenu };
  else if (etape.type_contenu === 'photo') contenu_revele = { type: 'photo', photo_url: etape.photo_url };

  return c.json({ ok: true, ...resultatXp, contenu_revele });
}

// Validation par scan de QR (mode chasse au trésor).
app.post('/valider', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const schema = z.object({ qr_token: z.string().uuid(), reponse: z.string().max(200).optional() });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id,chasse_id,ordre,type_contenu,contenu,photo_url,enigme_reponse',
    commune_id: `eq.${commune_id}`, qr_token: `eq.${body.data.qr_token}`,
  });
  if (!etape) return c.json({ erreur: 'QR code invalide' }, 404);

  return finaliserValidationEtape(c, commune_id, user_id, etape, body.data.reponse);
});

// Validation par proximité GPS (mode balade guidée) : pas de QR, on vérifie que le joueur
// est bien à moins de `rayon_metres` du point.
app.post('/valider-position', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const schema = z.object({
    etape_id: z.string().uuid(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    reponse: z.string().max(200).optional(),
  });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id,chasse_id,ordre,lat,lng,type_contenu,contenu,photo_url,enigme_reponse',
    commune_id: `eq.${commune_id}`, id: `eq.${body.data.etape_id}`,
  });
  if (!etape) return c.json({ erreur: 'Étape introuvable' }, 404);

  const [chasse] = await supabaseSelect(c.env, 'chasses_tresor', {
    select: 'rayon_metres', commune_id: `eq.${commune_id}`, id: `eq.${etape.chasse_id}`,
  });
  const rayon = chasse?.rayon_metres ?? 50;
  const distance = distanceMetres(body.data.lat, body.data.lng, etape.lat, etape.lng);

  // La proximité n'est contournée que pour la 2e étape d'une énigme (soumission de la
  // réponse), où elle a déjà été vérifiée au 1er appel — jamais pour texte/photo/aucun.
  const soumissionReponseEnigme = etape.type_contenu === 'enigme' && !!body.data.reponse;
  if (distance > rayon && !soumissionReponseEnigme) {
    return c.json({ ok: true, reussi: false, distance_metres: Math.round(distance) });
  }

  return finaliserValidationEtape(c, commune_id, user_id, etape, body.data.reponse);
});

// GET /classement-exploration — score combiné (étapes de chasse validées + énigmes trouvées),
// affiché depuis l'onglet fusionné Chasse au trésor / Énigme photo.
app.get('/classement-exploration', async (c) => {
  const commune_id = c.get('commune_id');
  const users = await supabaseSelect(c.env, 'users', {
    select: 'prenom,etapes_chasse_validees,enigmes_trouvees',
    commune_id: `eq.${commune_id}`,
  });

  const classement = users
    .map((u: any) => ({
      prenom: u.prenom,
      etapes: u.etapes_chasse_validees ?? 0,
      enigmes: u.enigmes_trouvees ?? 0,
      score: (u.etapes_chasse_validees ?? 0) + (u.enigmes_trouvees ?? 0),
    }))
    .filter((u: any) => u.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 20);

  return c.json({ classement });
});

app.get('/:id/classement', async (c) => {
  const commune_id = c.get('commune_id');
  const chasse_id = c.req.param('id');

  const progressions = await supabaseSelect(c.env, 'progressions_chasse', {
    select: 'user_id,validee_at',
    commune_id: `eq.${commune_id}`, chasse_id: `eq.${chasse_id}`,
    order: 'validee_at.asc',
  });
  const users = await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom',
    commune_id: `eq.${commune_id}`,
  });

  const parUtilisateur = new Map<string, { total: number; derniere: string }>();
  for (const p of progressions) {
    const entree = parUtilisateur.get(p.user_id) ?? { total: 0, derniere: p.validee_at };
    entree.total += 1;
    entree.derniere = p.validee_at;
    parUtilisateur.set(p.user_id, entree);
  }

  const classement = [...parUtilisateur.entries()]
    .map(([user_id, stats]) => {
      const u = users.find((u: any) => u.id === user_id);
      return { prenom: u?.prenom ?? '?', total_etapes: stats.total, derniere_validation: stats.derniere };
    })
    .sort((a, b) => b.total_etapes - a.total_etapes || a.derniere_validation.localeCompare(b.derniere_validation));

  return c.json({ classement });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'chasses_tresor', {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

export default app;

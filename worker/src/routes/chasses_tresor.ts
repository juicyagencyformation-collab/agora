// worker/src/routes/chasses_tresor.ts
import { COLONNES_NOM_PUBLIC, nomPublic } from '../lib/nom-public';
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';
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
  const role = c.get('role');

  // Vue "archives" (gestionnaire uniquement) : liste légère des chasses retirées (actif=false),
  // sans calcul de progression — sert uniquement à en retrouver une pour la réactiver, voir
  // PATCH /:id. Une chasse archivée n'est jamais jouable ni visible des citoyens.
  if (c.req.query('archivees') === 'true' && estGestionnaire(role)) {
    const chassesArchivees = await supabaseSelect(c.env, 'chasses_tresor', {
      select: 'id,titre,description,actif,mode,rayon_metres,created_at',
      commune_id: `eq.${commune_id}`,
      actif: 'eq.false',
      order: 'created_at.desc',
    });
    return c.json({ chasses: chassesArchivees });
  }

  return c.json({ chasses: await listerChassesJouables(c.env, commune_id, user_id) });
});

// Chasses actives d'une commune, avec la progression du joueur. Partagé avec
// routes/jeux_ailleurs.ts (joueur venu d'une autre commune) : une seule projection des colonnes,
// donc un seul endroit où vérifier que rien de secret (qr_token, réponses) ne sort.
export async function listerChassesJouables(env: any, commune_id: string, user_id: string) {
  const chasses = await supabaseSelect(env, 'chasses_tresor', {
    select: 'id,titre,description,actif,mode,rayon_metres,created_at',
    commune_id: `eq.${commune_id}`,
    actif: 'eq.true',
    order: 'created_at.desc',
  });
  const ids = chasses.map((ch: any) => ch.id);
  if (!ids.length) return [];

  const [etapes, progressions] = await Promise.all([
    supabaseSelect(env, 'etapes_chasse', {
      select: 'id,chasse_id,ordre,titre,indice,lat,lng,type_contenu,contenu,photo_url',
      commune_id: `eq.${commune_id}`,
      chasse_id: `in.(${ids.join(',')})`,
      order: 'ordre.asc',
    }),
    supabaseSelect(env, 'progressions_chasse', {
      select: 'chasse_id,etape_id,user_id,validee_at',
      commune_id: `eq.${commune_id}`,
      chasse_id: `in.(${ids.join(',')})`,
      user_id: `eq.${user_id}`,
    }),
  ]);

  return chasses.map((ch: any) => {
    const etapesChasse = etapes.filter((e: any) => e.chasse_id === ch.id);
    const etapesValidees = progressions.filter((p: any) => p.chasse_id === ch.id).map((p: any) => p.etape_id);
    const suivante = etapesChasse.find((e: any) => !etapesValidees.includes(e.id)) ?? null;
    const base: any = {
      ...ch,
      total_etapes: etapesChasse.length,
      etapes_validees: etapesValidees.length,
      // Mode chasse : seul l'indice sort. Le titre (« Le lavoir ») et les coordonnées révéleraient
      // la cachette à quiconque lit la réponse réseau (corrigé le 2026-11-05, ils sortaient avant).
      etape_suivante: suivante && (ch.mode === 'balade'
        ? { id: suivante.id, ordre: suivante.ordre, titre: suivante.titre, indice: suivante.indice, lat: suivante.lat, lng: suivante.lng, type_contenu: suivante.type_contenu }
        : { id: suivante.id, ordre: suivante.ordre, indice: suivante.indice, type_contenu: suivante.type_contenu }),
      // Carnet de découvertes (2026-11-05) : le texte ou la photo révélés par les étapes que CE
      // joueur a déjà validées, pour les relire à tout moment. Jamais ceux d'une étape non validée,
      // ni la question/réponse d'une étape énigme.
      decouvertes: etapesChasse
        .filter((e: any) => etapesValidees.includes(e.id) && ['texte', 'photo'].includes(e.type_contenu))
        .map((e: any) => ({
          ordre: e.ordre, titre: e.titre, type: e.type_contenu,
          // Découverte = texte + photo facultative (2026-11-05) ; 'photo' seule reste lue (anciennes étapes).
          ...(e.type_contenu === 'texte' ? { texte: e.contenu } : {}),
          ...(e.photo_url ? { photo_url: e.photo_url } : {}),
        })),
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
}

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
    select: 'id,ordre,titre,indice,lat,lng,type_contenu,contenu,photo_r2_key,enigme_reponse',
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
    commune_id: `eq.${commune_id}`, chasse_id: `eq.${c.req.param('id')}`, id: `eq.${c.req.param('etapeId')}`,
  });
  if (!etape) return c.json({ erreur: 'Étape introuvable' }, 404);

  const svg = genererQrSvg(etape.qr_token);
  return c.html(`<div>${svg}<p style="font-family:monospace">${etape.qr_token}</p></div>`);
});

// PATCH /:id/etapes/:etapeId — corrige une étape existante (titre, indice, position, contenu...)
// sans toucher son id ni régénérer son qr_token : les QR codes déjà imprimés et posés dans la
// commune restent valides. Portée volontairement limitée à la correction : ajouter, retirer ou
// réordonner des étapes nécessite toujours de recréer la chasse.
app.patch('/:id/etapes/:etapeId', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const chasse_id = c.req.param('id');
  const etape_id = c.req.param('etapeId');

  const body = etapeSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [etapeActuelle] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'photo_r2_key', commune_id: `eq.${commune_id}`, chasse_id: `eq.${chasse_id}`, id: `eq.${etape_id}`,
  });
  if (!etapeActuelle) return c.json({ erreur: 'Étape introuvable' }, 404);

  // La photo est remplacée par une autre (ou retirée) : celle qui était en place devient
  // orpheline en R2 si on ne l'efface pas explicitement (même piège que la suppression de chasse).
  if (etapeActuelle.photo_r2_key && etapeActuelle.photo_r2_key !== data.photo_r2_key) {
    await deleteObject(c.env, etapeActuelle.photo_r2_key);
  }

  await supabaseUpdate(c.env, 'etapes_chasse', {
    titre: data.titre, indice: data.indice, lat: data.lat, lng: data.lng,
    type_contenu: data.type_contenu,
    contenu: data.contenu?.trim() || null,
    photo_url: data.photo_r2_key ? `${c.env.R2_PUBLIC_BASE}/${data.photo_r2_key}` : null,
    photo_r2_key: data.photo_r2_key || null,
    enigme_reponse: data.type_contenu === 'enigme' ? (data.enigme_reponse?.trim() || null) : null,
  }, { id: `eq.${etape_id}`, commune_id: `eq.${commune_id}`, chasse_id: `eq.${chasse_id}` });

  return c.json({ ok: true });
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
// Deux communes distinctes depuis le 2026-11-03 (voir routes/jeux_ailleurs.ts) : commune_id =
// celle de la chasse (progression enregistrée chez elle), commune_joueur = celle du compte (XP,
// compteurs, badges). Identiques pour un habitant qui joue chez lui. extra : champs ajoutés à
// la réponse (ex. nom de la commune visitée).
export async function finaliserValidationEtape(c: any, commune_id: string, commune_joueur: string, user_id: string, etape: any, reponse?: string, extra: Record<string, unknown> = {}) {
  // Ordre : toute découverte ou énigme précédente doit être validée. Les POINTS DE PASSAGE manqués
  // (téléphone en poche, pas de réseau…) ne bloquent pas : ils sont cochés avec cette étape, sans
  // aucun point (ils n'en rapportent jamais — aucun intérêt à les sauter pour tricher). 2026-11-05.
  let passagesARattraper: any[] = [];
  if (etape.ordre > 0) {
    const etapesPrecedentes = await supabaseSelect(c.env, 'etapes_chasse', {
      select: 'id,type_contenu',
      commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, ordre: `lt.${etape.ordre}`,
    });
    const progressions = await supabaseSelect(c.env, 'progressions_chasse', {
      select: 'etape_id',
      commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, user_id: `eq.${user_id}`,
    });
    const idsValides = progressions.map((p: any) => p.etape_id);
    const manquantes = etapesPrecedentes.filter((e: any) => !idsValides.includes(e.id));
    if (manquantes.some((e: any) => e.type_contenu !== 'aucun')) return c.json({ erreur: 'Étapes précédentes non validées' }, 400);
    passagesARattraper = manquantes;
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
      return c.json({ ok: true, etape_enigme: true, question: etape.contenu, ...extra });
    }
    if (normaliserReponse(reponseSaisie) !== normaliserReponse(etape.enigme_reponse ?? '')) {
      return c.json({ erreur: 'Mauvaise réponse, réessaie.' }, 400);
    }
  }

  // Une seule écriture : les points de passage rattrapés puis l'étape elle-même.
  const maintenant = new Date().toISOString();
  await supabaseInsert(c.env, 'progressions_chasse', [...passagesARattraper, etape].map((e: any) => ({
    commune_id, chasse_id: etape.chasse_id, etape_id: e.id, user_id, validee_at: maintenant,
  })));

  // Point de passage (type 'aucun' : balisage, changement de direction) : ne rapporte RIEN — ni
  // points, ni compteur d'étapes, ni série (décision de Léandre, 2026-11-05). C'est terminer le
  // parcours qui récompense (bonus terminer_parcours + badge Finisseur au premier).
  const estPassage = etape.type_contenu === 'aucun';
  if (!estPassage) await incrementerCompteurUtilisateur(c.env, commune_joueur, user_id, 'etapes_chasse_validees');

  // Détecte la complétion à 100% de CETTE chasse (badge "Finisseur", distinct du simple cumul).
  // Une seule fois par joueur : la dernière étape ne peut être validée qu'une fois.
  const toutesEtapesChasse = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id', commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`,
  });
  const mesProgressionsChasse = await supabaseSelect(c.env, 'progressions_chasse', {
    select: 'id', commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, user_id: `eq.${user_id}`,
  });
  const parcoursTermine = mesProgressionsChasse.length >= toutesEtapesChasse.length;
  if (parcoursTermine) await incrementerCompteurUtilisateur(c.env, commune_joueur, user_id, 'chasses_terminees');

  if (!estPassage || parcoursTermine) await gererStreakExploration(c.env, commune_joueur, user_id);
  const xp = (estPassage ? 0 : XP_ACTIONS.valider_etape_chasse) + (parcoursTermine ? XP_ACTIONS.terminer_parcours : 0);
  const resultatXp = xp ? await attribuerXp(c.env, commune_joueur, user_id, xp) : {};

  // Contenu à révéler côté joueur une fois l'étape validée.
  let contenu_revele: { type: string; texte?: string; photo_url?: string } | null = null;
  // Découverte : texte, avec sa photo s'il y en a une (fusion texte + photo du 2026-11-05).
  if (etape.type_contenu === 'texte') contenu_revele = { type: 'texte', texte: etape.contenu, ...(etape.photo_url ? { photo_url: etape.photo_url } : {}) };
  else if (etape.type_contenu === 'photo') contenu_revele = { type: 'photo', photo_url: etape.photo_url };
  // Consigne d'orientation d'un point de passage (« Prenez à gauche après le calvaire ») : affichée
  // à l'arrivée, jamais rangée dans le carnet de découvertes.
  else if (estPassage && etape.contenu) contenu_revele = { type: 'consigne', texte: etape.contenu };

  return c.json({ ok: true, ...resultatXp, contenu_revele, point_de_passage: estPassage, passages_rattrapes: passagesARattraper.length, parcours_termine: parcoursTermine, ...extra });
}

// Validation par scan de QR (mode chasse au trésor). Depuis le 2026-11-05, la position du joueur
// est exigée aussi : une photo du QR partagée en ligne ne suffit plus à valider depuis chez soi.
export const validationQrSchema = z.object({
  qr_token: z.string().uuid(),
  reponse: z.string().max(200).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const COLONNES_ETAPE_QR = 'id,commune_id,chasse_id,ordre,lat,lng,type_contenu,contenu,photo_url,enigme_reponse';

// Tolérance large et fixe (le QR est physiquement sur place) : couvre l'imprécision du GPS à
// l'intérieur d'une église ou contre un mur épais, tout en écartant la validation à distance.
// Le rayon de la chasse s'applique s'il est plus grand.
export const RAYON_SCAN_QR_METRES = 200;

// Partagé avec routes/jeux_ailleurs.ts (POST /valider-qr). null = joueur assez proche.
export function erreurDistanceQr(etape: { lat: number; lng: number }, rayonChasse: number | null, position: { lat: number; lng: number }) {
  const distance = distanceMetres(position.lat, position.lng, etape.lat, etape.lng);
  if (distance <= Math.max(rayonChasse ?? 0, RAYON_SCAN_QR_METRES)) return null;
  return {
    erreur: `Vous semblez être à ${Math.round(distance)} m de cette étape : le QR code se valide sur place.`,
    distance_metres: Math.round(distance),
  };
}

app.post('/valider', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = validationQrSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: COLONNES_ETAPE_QR,
    commune_id: `eq.${commune_id}`, qr_token: `eq.${body.data.qr_token}`,
  });
  if (!etape) return c.json({ erreur: 'QR code invalide' }, 404);

  // Une chasse archivée (actif=false) n'est plus jouable — même logique que le masquage
  // immédiat des énigmes signalées : rien ne doit rester validable une fois retiré de la liste.
  const [chasseActive] = await supabaseSelect(c.env, 'chasses_tresor', {
    select: 'id,rayon_metres', commune_id: `eq.${commune_id}`, id: `eq.${etape.chasse_id}`, actif: 'eq.true',
  });
  if (!chasseActive) return c.json({ erreur: 'Cette chasse n\'est plus active' }, 404);

  const tropLoin = erreurDistanceQr(etape, chasseActive.rayon_metres, body.data);
  if (tropLoin) return c.json(tropLoin, 400);

  return finaliserValidationEtape(c, commune_id, commune_id, user_id, etape, body.data.reponse);
});

// Validation par proximité GPS (mode balade guidée) : pas de QR, on vérifie que le joueur
// est bien à moins de `rayon_metres` du point.
export const validationPositionSchema = z.object({
  etape_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  reponse: z.string().max(200).optional(),
});

app.post('/valider-position', async (c) => {
  const commune_id = c.get('commune_id');
  const body = validationPositionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  return validerEtapeParPosition(c, commune_id, commune_id, c.get('user_id'), body.data);
});

// Partagé avec routes/jeux_ailleurs.ts — voir finaliserValidationEtape pour les deux communes.
export async function validerEtapeParPosition(c: any, commune_id: string, commune_joueur: string, user_id: string, data: z.infer<typeof validationPositionSchema>) {
  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id,chasse_id,ordre,lat,lng,type_contenu,contenu,photo_url,enigme_reponse',
    commune_id: `eq.${commune_id}`, id: `eq.${data.etape_id}`,
  });
  if (!etape) return c.json({ erreur: 'Étape introuvable' }, 404);

  const [chasse] = await supabaseSelect(c.env, 'chasses_tresor', {
    select: 'rayon_metres,actif', commune_id: `eq.${commune_id}`, id: `eq.${etape.chasse_id}`,
  });
  if (!chasse?.actif) return c.json({ erreur: 'Cette chasse n\'est plus active' }, 404);

  const rayon = chasse.rayon_metres ?? 50;
  const distance = distanceMetres(data.lat, data.lng, etape.lat, etape.lng);

  // Toujours vérifié, y compris à la soumission de la réponse d'une énigme : le client
  // renvoie une vraie lecture GPS fraîche à cet appel aussi (voir validerEtapePosition côté
  // frontend), donc rien ne justifie de faire confiance à un ancien contrôle non prouvé —
  // l'ancien contournement ("déjà vérifié au 1er appel") permettait de valider une étape
  // énigme depuis n'importe où dès lors qu'on connaissait la réponse.
  if (distance > rayon) {
    return c.json({ ok: true, reussi: false, distance_metres: Math.round(distance) });
  }

  return finaliserValidationEtape(c, commune_id, commune_joueur, user_id, etape, data.reponse);
}

// GET /classement-exploration — score combiné (étapes de chasse validées + énigmes trouvées),
// affiché depuis l'onglet fusionné Chasse au trésor / Énigme photo.
app.get('/classement-exploration', async (c) => {
  const commune_id = c.get('commune_id');
  const users = await supabaseSelect(c.env, 'users', {
    select: `${COLONNES_NOM_PUBLIC},etapes_chasse_validees,enigmes_trouvees`,
    commune_id: `eq.${commune_id}`,
  });

  const classement = users
    .map((u: any) => ({
      prenom: [nomPublic(u, c.get('user_id')).prenom, nomPublic(u, c.get('user_id')).nom].filter(Boolean).join(' '),
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
  return c.json({ classement: await classementChasse(c.env, c.get('commune_id'), c.req.param('id'), c.get('user_id')) });
});

// Partagé avec routes/jeux_ailleurs.ts. Les joueurs sont lus par identifiant et non par commune :
// depuis le 2026-11-03, un habitant d'une autre commune peut avoir joué cette chasse et doit y
// figurer — seul son nom public sort (nomPublic : prénom + initiale, ou « anonyme » selon SON
// réglage de confidentialité), jamais rien d'autre de son compte.
export async function classementChasse(env: any, commune_id: string, chasse_id: string, viewer_id: string) {
  const progressions = await supabaseSelect(env, 'progressions_chasse', {
    select: 'user_id,validee_at',
    commune_id: `eq.${commune_id}`, chasse_id: `eq.${chasse_id}`,
    order: 'validee_at.asc',
  });
  const idsJoueurs = [...new Set(progressions.map((p: any) => p.user_id))];
  const users = idsJoueurs.length ? await supabaseSelect(env, 'users', {
    select: COLONNES_NOM_PUBLIC,
    id: `in.(${idsJoueurs.join(',')})`,
  }) : [];

  const parUtilisateur = new Map<string, { total: number; derniere: string }>();
  for (const p of progressions) {
    const entree = parUtilisateur.get(p.user_id) ?? { total: 0, derniere: p.validee_at };
    entree.total += 1;
    entree.derniere = p.validee_at;
    parUtilisateur.set(p.user_id, entree);
  }

  return [...parUtilisateur.entries()]
    .map(([user_id, stats]) => {
      const u = users.find((u: any) => u.id === user_id);
      const n = nomPublic(u, viewer_id);
      return { prenom: [n.prenom, n.nom].filter(Boolean).join(' '), total_etapes: stats.total, derniere_validation: stats.derniere };
    })
    .sort((a, b) => b.total_etapes - a.total_etapes || a.derniere_validation.localeCompare(b.derniere_validation));
}

// PATCH /:id — corrige le titre, la description ou le rayon de validation d'une chasse déjà
// créée, et sert aussi à l'archiver/la réactiver (actif). Le mode (chasse/balade) n'est pas
// modifiable : il détermine comment TOUTES les étapes sont validées (scan QR vs. proximité
// GPS), le changer à mi-course casserait les étapes déjà en place — recréer la chasse reste la
// seule option pour ce cas précis.
const editionChasseSchema = z.object({
  titre: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  rayon_metres: z.number().int().min(20).max(500).optional(),
  actif: z.boolean().optional(),
});

app.patch('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const body = editionChasseSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const patch: Record<string, unknown> = { titre: body.data.titre, description: body.data.description?.trim() || null };
  if (body.data.rayon_metres !== undefined) patch.rayon_metres = body.data.rayon_metres;
  if (body.data.actif !== undefined) patch.actif = body.data.actif;

  await supabaseUpdate(c.env, 'chasses_tresor', patch, {
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
  const chasse_id = c.req.param('id');

  // Anti-farming (règle non négociable du projet, voir CLAUDE.md — "jamais d'XP en boucle,
  // supprimer/recréer") : une chasse déjà jouée par au moins un citoyen ne peut plus être
  // supprimée définitivement. La recréer à l'identique générerait de nouvelles etape_id, et le
  // garde-fou XP (« cet etape_id est-il déjà validé par cet utilisateur ? ») ne s'appliquerait
  // alors plus — chaque participant regagnerait le XP déjà gagné. Seul l'archivage (PATCH /:id,
  // actif=false) reste possible pour une chasse jouée : les etape_id ne changent pas, impossible
  // d'y regagner du XP même en la réactivant. Une chasse jamais jouée reste librement supprimable.
  const [uneProgression] = await supabaseSelect(c.env, 'progressions_chasse', {
    select: 'user_id', commune_id: `eq.${commune_id}`, chasse_id: `eq.${chasse_id}`, limit: '1',
  });
  if (uneProgression) {
    return c.json({
      erreur: 'Cette chasse a déjà des participations : archive-la plutôt que de la supprimer, pour éviter de permettre de regagner du XP en la recréant à l’identique.',
    }, 400);
  }

  // Les étapes de type "photo" ont chacune leur propre fichier R2 : la suppression en base
  // (cascade sur etapes_chasse) ne libère rien côté stockage, il faut l'effacer explicitement.
  const etapes = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'photo_r2_key', commune_id: `eq.${commune_id}`, chasse_id: `eq.${chasse_id}`,
    photo_r2_key: 'not.is.null',
  });
  for (const e of etapes) {
    await deleteObject(c.env, e.photo_r2_key);
  }

  await supabaseDelete(c.env, 'chasses_tresor', {
    id: `eq.${chasse_id}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

export default app;

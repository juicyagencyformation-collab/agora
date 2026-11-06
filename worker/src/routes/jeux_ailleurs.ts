// worker/src/routes/jeux_ailleurs.ts
// Jouer aux chasses au trésor et énigmes photo d'une AUTRE commune avec son propre compte.
//
// ⚠️ EXCEPTION ENCADRÉE à la règle n°2 du projet (« commune_id toujours extrait du JWT »),
// validée par Léandre le 2026-11-03 — voir CLAUDE.md. Ce fichier est le SEUL endroit de l'app où
// un compte agit dans une commune qui n'est pas la sienne. Garde-fous, à préserver si on y touche :
// - le JWT reste celui du joueur (jwtMiddleware : le :slug de l'URL est SA commune) ; la commune
//   visitée est résolue côté serveur, à partir de son slug ou d'un qr_token, jamais d'un id client ;
// - lecture limitée aux chasses/énigmes ACTIVES, via les mêmes fonctions que les routes normales
//   (listerChassesJouables, listerEnigmesJouables) : jamais de qr_token, de réponse ni de position
//   d'énigme non résolue — et rien d'autre de la commune (habitants, mur, actualités...) ;
// - écritures limitées à : valider une étape, valider une énigme, signaler une énigme. La
//   réussite est enregistrée chez la commune visitée ; XP, compteurs et badges vont au compte du
//   joueur (commune_joueur) ;
// - commune visitée : active, ni nationale ni démo, différente de celle du joueur, module actif.
import { Hono } from 'hono';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect } from '../db';
import { COLONNES_NOM_PUBLIC, nomPublic } from '../lib/nom-public';
import {
  listerChassesJouables, finaliserValidationEtape, validerEtapeParPosition, validationPositionSchema, classementChasse,
  validationQrSchema, COLONNES_ETAPE_QR, erreurDistanceQr,
} from './chasses_tresor';
import { listerEnigmesJouables, validerEnigme, validationEnigmeSchema, signalerEnigme } from './enigmes';
import { SLUGS_COMMUNES_TEST, SLUGS_TEST_VISIBLES_DANS_LES_JEUX } from '../lib/communes-test';
import { distanceMetres } from '../lib/geo';

const app = new Hono();
app.use('*', jwtMiddleware);

type Module = 'chasse_tresor' | 'enigmes';
type CommuneVisitee = { id: string; nom: string; slug: string };

// Toutes les conditions d'accès à une commune visitée, au même endroit. null = refus, sans dire
// pourquoi (inexistante, suspendue, démo... : même réponse, rien à deviner de l'extérieur).
async function communeVisitable(env: any, filtre: Record<string, string>, communeJoueur: string, module: Module): Promise<CommuneVisitee | null> {
  const [commune] = await supabaseSelect(env, 'communes', {
    select: 'id,nom,slug,statut_client,niveau_national,acces_libre', ...filtre,
  });
  if (!commune || commune.id === communeJoueur) return null;
  if (commune.statut_client === 'suspendue' || commune.statut_client === 'resiliee') return null;
  if (commune.niveau_national || commune.acces_libre) return null;
  // Même règle que requireOngletActif : pas de ligne = actif, seule une désactivation explicite bloque.
  const [onglet] = await supabaseSelect(env, 'onglets_config', {
    select: 'actif', commune_id: `eq.${commune.id}`, cle: `eq.${module}`,
  });
  if (onglet?.actif === false) return null;
  return { id: commune.id, nom: commune.nom, slug: commune.slug };
}

const parSlug = (slug: string) => ({ slug: `eq.${slug}` });
const INTROUVABLE = { erreur: 'Aucune chasse ni énigme ouverte aux visiteurs dans cette commune.' };

// GET /communes?lat=&lng= — villages où aller jouer : seulement ceux qui ont AU MOINS une chasse
// ou une énigme active (avant le 2026-11-05 : recherche par nom parmi ~14 000 communes, la plupart
// sans aucun jeu). Renvoie le nombre de jeux et le centre de la commune (déjà public), jamais la
// position d'une étape ou d'une énigme. Avec lat/lng (position du joueur ou centre de sa commune),
// chaque village porte sa distance et la liste est triée du plus proche au plus loin ; la recherche
// par nom et le filtre de distance se font côté téléphone sur cette liste, courte par nature.
app.get('/communes', async (c) => {
  const communeJoueur = c.get('commune_id');
  const [chasses, enigmes] = await Promise.all([
    supabaseSelect(c.env, 'chasses_tresor', { select: 'commune_id', actif: 'eq.true', limit: '1000' }),
    supabaseSelect(c.env, 'photos_enigmes', { select: 'commune_id', statut: 'eq.active', limit: '1000' }),
  ]);
  const compter = (lignes: any[]) => lignes.reduce((m: Map<string, number>, l: any) => m.set(l.commune_id, (m.get(l.commune_id) ?? 0) + 1), new Map<string, number>());
  const nbChasses = compter(chasses);
  const nbEnigmes = compter(enigmes);
  const ids = [...new Set([...nbChasses.keys(), ...nbEnigmes.keys()])].filter((id) => id !== communeJoueur);
  if (!ids.length) return c.json({ communes: [] });

  const exclues = SLUGS_COMMUNES_TEST.filter((slug) => !SLUGS_TEST_VISIBLES_DANS_LES_JEUX.includes(slug));
  const [communes, desactives] = await Promise.all([
    supabaseSelect(c.env, 'communes', {
      select: 'id,nom,slug,departement,lat,lng',
      id: `in.(${ids.join(',')})`,
      statut_client: 'eq.active',
      niveau_national: 'not.is.true',
      acces_libre: 'not.is.true',
      slug: `not.in.(${exclues.join(',')})`,
    }),
    // Même règle que communeVisitable : seule une désactivation explicite coupe un module.
    supabaseSelect(c.env, 'onglets_config', {
      select: 'commune_id,cle', commune_id: `in.(${ids.join(',')})`, cle: 'in.(chasse_tresor,enigmes)', actif: 'eq.false',
    }),
  ]);
  const coupe = (id: string, cle: string) => desactives.some((d: any) => d.commune_id === id && d.cle === cle);

  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  const avecPosition = Number.isFinite(lat) && Number.isFinite(lng) && c.req.query('lat') !== undefined;
  const villages = communes
    .map((cm: any) => {
      const nb_chasses = coupe(cm.id, 'chasse_tresor') ? 0 : (nbChasses.get(cm.id) ?? 0);
      const nb_enigmes = coupe(cm.id, 'enigmes') ? 0 : (nbEnigmes.get(cm.id) ?? 0);
      const situe = cm.lat != null && cm.lng != null;
      return {
        // Commune d'essai visible temporairement : signalée comme telle (même nom que la vraie Eaucourt).
        nom: SLUGS_TEST_VISIBLES_DANS_LES_JEUX.includes(cm.slug) ? `${cm.nom} (essai)` : cm.nom, slug: cm.slug, departement: cm.departement ?? null, nb_chasses, nb_enigmes,
        lat: situe ? Number(cm.lat) : null, lng: situe ? Number(cm.lng) : null,
        distance_km: avecPosition && situe ? Math.round(distanceMetres(lat, lng, Number(cm.lat), Number(cm.lng)) / 100) / 10 : null,
      };
    })
    .filter((v: any) => v.nb_chasses + v.nb_enigmes > 0)
    .sort((a: any, b: any) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) || a.nom.localeCompare(b.nom, 'fr'));
  return c.json({ communes: villages });
});

// POST /valider-qr — un QR d'étape scanné n'importe où : la commune est retrouvée à partir du
// qr_token (unique sur toute la plateforme, imprimé à l'étape), et la position du joueur doit être
// proche de l'étape (erreurDistanceQr), exactement comme chez soi.
app.post('/valider-qr', async (c) => {
  const body = validationQrSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const communeJoueur = c.get('commune_id');

  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: COLONNES_ETAPE_QR,
    qr_token: `eq.${body.data.qr_token}`,
  });
  if (!etape) return c.json({ erreur: 'QR code invalide' }, 404);
  if (etape.commune_id === communeJoueur) {
    return c.json({ erreur: 'Cette étape est dans votre commune : validez-la depuis vos chasses.' }, 400);
  }

  const commune = await communeVisitable(c.env, { id: `eq.${etape.commune_id}` }, communeJoueur, 'chasse_tresor');
  if (!commune) return c.json({ erreur: 'QR code invalide' }, 404);

  const [chasseActive] = await supabaseSelect(c.env, 'chasses_tresor', {
    select: 'id,rayon_metres', commune_id: `eq.${commune.id}`, id: `eq.${etape.chasse_id}`, actif: 'eq.true',
  });
  if (!chasseActive) return c.json({ erreur: 'Cette chasse n\'est plus active' }, 404);

  const tropLoin = erreurDistanceQr(etape, chasseActive.rayon_metres, body.data);
  if (tropLoin) return c.json(tropLoin, 400);

  return finaliserValidationEtape(c, commune.id, communeJoueur, c.get('user_id'), etape, body.data.reponse, { commune_nom: commune.nom });
});

// GET /:cible — chasses et énigmes jouables de la commune visitée, et le nom sous lequel le
// joueur y apparaît (son réglage « Mon nom sur mes publications et dans les classements »).
app.get('/:cible', async (c) => {
  const communeJoueur = c.get('commune_id');
  const user_id = c.get('user_id');
  const [pourChasses, pourEnigmes] = await Promise.all([
    communeVisitable(c.env, parSlug(c.req.param('cible')), communeJoueur, 'chasse_tresor'),
    communeVisitable(c.env, parSlug(c.req.param('cible')), communeJoueur, 'enigmes'),
  ]);
  const commune = pourChasses ?? pourEnigmes;
  if (!commune) return c.json(INTROUVABLE, 404);

  const [chasses, enigmes, [moi]] = await Promise.all([
    pourChasses ? listerChassesJouables(c.env, commune.id, user_id) : [],
    pourEnigmes ? listerEnigmesJouables(c.env, commune.id, user_id) : [],
    supabaseSelect(c.env, 'users', { select: COLONNES_NOM_PUBLIC, id: `eq.${user_id}`, commune_id: `eq.${communeJoueur}` }),
  ]);
  const n = nomPublic(moi, '');
  return c.json({
    commune: { nom: commune.nom, slug: commune.slug },
    chasses, enigmes,
    mon_nom_public: [n.prenom, n.nom].filter(Boolean).join(' '),
  });
});

app.post('/:cible/chasses-tresor/valider-position', async (c) => {
  const communeJoueur = c.get('commune_id');
  const commune = await communeVisitable(c.env, parSlug(c.req.param('cible')), communeJoueur, 'chasse_tresor');
  if (!commune) return c.json(INTROUVABLE, 404);
  const body = validationPositionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  return validerEtapeParPosition(c, commune.id, communeJoueur, c.get('user_id'), body.data);
});

app.get('/:cible/chasses-tresor/:id/classement', async (c) => {
  const commune = await communeVisitable(c.env, parSlug(c.req.param('cible')), c.get('commune_id'), 'chasse_tresor');
  if (!commune) return c.json(INTROUVABLE, 404);
  return c.json({ classement: await classementChasse(c.env, commune.id, c.req.param('id'), c.get('user_id')) });
});

app.post('/:cible/enigmes/:id/valider', async (c) => {
  const communeJoueur = c.get('commune_id');
  const commune = await communeVisitable(c.env, parSlug(c.req.param('cible')), communeJoueur, 'enigmes');
  if (!commune) return c.json(INTROUVABLE, 404);
  const body = validationEnigmeSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  return validerEnigme(c, commune.id, communeJoueur, c.get('user_id'), c.req.param('id'), body.data);
});

// Signaler depuis un autre village (2026-11-06) : un signalement masque l'énigme aussitôt (règle
// n°4). Sans garde-fou, une armée de comptes Explorateurs créés en masse pourrait masquer toutes
// les énigmes de France en quelques minutes. Il faut donc avoir déjà réussi un jeu sur place
// (étape ou énigme, n'importe où), et 3 signalements par jour au plus. Les habitants de la
// commune signalent sans restriction (routes/enigmes.ts).
export const MAX_SIGNALEMENTS_VISITEUR_JOUR = 3;

app.post('/:cible/enigmes/:id/signaler', async (c) => {
  const commune = await communeVisitable(c.env, parSlug(c.req.param('cible')), c.get('commune_id'), 'enigmes');
  if (!commune) return c.json(INTROUVABLE, 404);
  const user_id = c.get('user_id');
  const [[etape], [enigme], signalementsDuJour] = await Promise.all([
    supabaseSelect(c.env, 'progressions_chasse', { select: 'id', user_id: `eq.${user_id}`, limit: '1' }),
    supabaseSelect(c.env, 'enigme_reussites', { select: 'id', user_id: `eq.${user_id}`, limit: '1' }),
    supabaseSelect(c.env, 'enigme_signalements', {
      select: 'id', user_id: `eq.${user_id}`, created_at: `gte.${new Date(Date.now() - 24 * 3600_000).toISOString()}`,
    }),
  ]);
  if (!etape && !enigme) {
    return c.json({ erreur: 'Pour signaler une énigme d’un autre village, réussissez d’abord une étape ou une énigme sur place.' }, 403);
  }
  if (signalementsDuJour.length >= MAX_SIGNALEMENTS_VISITEUR_JOUR) {
    return c.json({ erreur: 'Vous avez déjà signalé 3 énigmes aujourd’hui : la mairie examine vos signalements.' }, 429);
  }
  return signalerEnigme(c, commune.id, c.get('user_id'), c.req.param('id'));
});

export default app;

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
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect } from '../db';
import { COLONNES_NOM_PUBLIC, nomPublic } from '../lib/nom-public';
import {
  listerChassesJouables, finaliserValidationEtape, validerEtapeParPosition, validationPositionSchema, classementChasse,
} from './chasses_tresor';
import { listerEnigmesJouables, validerEnigme, validationEnigmeSchema, signalerEnigme } from './enigmes';
import { motifNomCommune } from './decouverte';

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

// GET /communes?q= — communes où aller jouer (nom commençant par la saisie).
app.get('/communes', async (c) => {
  const q = (c.req.query('q') || '').trim().replace(/[*,()]/g, '');
  if (q.length < 2) return c.json({ communes: [] });

  const communes = await supabaseSelect(c.env, 'communes', {
    select: 'id,nom,slug,departement',
    nom: `imatch.^${motifNomCommune(q)}`,
    statut_client: 'eq.active',
    niveau_national: 'not.is.true',
    acces_libre: 'not.is.true',
    id: `neq.${c.get('commune_id')}`,
    order: 'nom.asc',
    limit: '15',
  });
  if (!communes.length) return c.json({ communes: [] });

  // Écarte les communes où les DEUX jeux sont désactivés.
  const desactives = await supabaseSelect(c.env, 'onglets_config', {
    select: 'commune_id,cle',
    commune_id: `in.(${communes.map((cm: any) => cm.id).join(',')})`,
    cle: 'in.(chasse_tresor,enigmes)',
    actif: 'eq.false',
  });
  const nbDesactives = new Map<string, number>();
  for (const d of desactives) nbDesactives.set(d.commune_id, (nbDesactives.get(d.commune_id) ?? 0) + 1);

  return c.json({
    communes: communes
      .filter((cm: any) => (nbDesactives.get(cm.id) ?? 0) < 2)
      .map((cm: any) => ({ nom: cm.nom, slug: cm.slug, departement: cm.departement ?? null })),
  });
});

// POST /valider-qr — un QR d'étape scanné n'importe où : la commune est retrouvée à partir du
// qr_token (unique sur toute la plateforme, et seulement lisible sur place, imprimé à l'étape).
const validationQrSchema = z.object({ qr_token: z.string().uuid(), reponse: z.string().max(200).optional() });

app.post('/valider-qr', async (c) => {
  const body = validationQrSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const communeJoueur = c.get('commune_id');

  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id,commune_id,chasse_id,ordre,type_contenu,contenu,photo_url,enigme_reponse',
    qr_token: `eq.${body.data.qr_token}`,
  });
  if (!etape) return c.json({ erreur: 'QR code invalide' }, 404);
  if (etape.commune_id === communeJoueur) {
    return c.json({ erreur: 'Cette étape est dans votre commune : validez-la depuis vos chasses.' }, 400);
  }

  const commune = await communeVisitable(c.env, { id: `eq.${etape.commune_id}` }, communeJoueur, 'chasse_tresor');
  if (!commune) return c.json({ erreur: 'QR code invalide' }, 404);

  const [chasseActive] = await supabaseSelect(c.env, 'chasses_tresor', {
    select: 'id', commune_id: `eq.${commune.id}`, id: `eq.${etape.chasse_id}`, actif: 'eq.true',
  });
  if (!chasseActive) return c.json({ erreur: 'Cette chasse n\'est plus active' }, 404);

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

app.post('/:cible/enigmes/:id/signaler', async (c) => {
  const commune = await communeVisitable(c.env, parSlug(c.req.param('cible')), c.get('commune_id'), 'enigmes');
  if (!commune) return c.json(INTROUVABLE, 404);
  return signalerEnigme(c, commune.id, c.get('user_id'), c.req.param('id'));
});

export default app;

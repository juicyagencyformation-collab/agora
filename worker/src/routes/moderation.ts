// worker/src/routes/moderation.ts
import { estGestionnaire, peutGererRoles, peutAttribuerRole } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseUpdate, supabaseInsert, supabaseDelete, enregistrerEvenementActivation } from '../db';
import { uploaderFichier } from '../storage';

const app = new Hono();
app.use('*', jwtMiddleware);

const ONGLETS_VALIDES = [
  'actualites', 'alertes', 'thermometre', 'mur', 'agenda',
  'coups_de_main', 'chasse_tresor', 'conseil', 'profil', 'annuaire', 'bulletin', 'photo_du_jour', 'enigmes', 'lois', 'memoire',
] as const;

// Déclencheurs valides pour un badge citoyen — les 5 "événement" sont des conditions fixes
// évaluées côté serveur (worker/src/lib/points-citoyens.ts), le superadmin ne peut pas en
// inventer de nouvelles ; "score_citoyen"/"streak_participation" sont génériques (valeur_seuil).
const DECLENCHEURS_BADGE_VALIDES = [
  'score_citoyen', 'streak_participation', 'premier_signalement_resolu',
  'premiere_action_organisee', 'valide_par_elu', 'streak_5_consecutives', 'streak_mensuel_6',
] as const;

app.get('/onglets', async (c) => {
  // Accessible à tout utilisateur connecté : savoir quels onglets sont actifs
  // n'est pas sensible, seule la capacité de les modifier l'est (PATCH ci-dessous).
  const commune_id = c.get('commune_id');
  const onglets = await supabaseSelect(c.env, 'onglets_config', {
    select: 'cle,actif',
    commune_id: `eq.${commune_id}`,
  });

  // Complète avec les onglets valides qui n'ont pas encore de ligne en base
  // (nouveaux modules ajoutés après la création de la commune) — actif par défaut.
  const clesExistantes = new Set(onglets.map((o: any) => o.cle));
  const completes = [
    ...onglets,
    ...ONGLETS_VALIDES.filter((cle) => !clesExistantes.has(cle)).map((cle) => ({ cle, actif: true })),
  ];

  return c.json({ onglets: completes });
});

// POST /onglets/:cle/verrouille-clique — signal d'intention (quelqu'un a cliqué un module que
// la mairie n'a pas activé) : le clic le plus significatif de toute la séquence d'onboarding/
// upsell, car il capture une intention réelle au moment où elle se produit (voir
// backoffice/onboarding-drip.ts et frontend/js/navigation.js). Accessible à tout utilisateur
// connecté (citoyen inclus) : ce n'est qu'un ping, aucune donnée sensible en jeu.
app.post('/onglets/:cle/verrouille-clique', async (c) => {
  const cle = c.req.param('cle');
  if (!ONGLETS_VALIDES.includes(cle as any)) return c.json({ erreur: 'Onglet invalide' }, 400);
  const commune_id = c.get('commune_id');
  await enregistrerEvenementActivation(c.env, commune_id, 'module_verrouille_clique');
  return c.json({ ok: true });
});

app.patch('/onglets/:cle', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') {
    return c.json({ erreur: 'Réservé au superadmin' }, 403);
  }
  const cle = c.req.param('cle');
  if (!ONGLETS_VALIDES.includes(cle as any)) {
    return c.json({ erreur: 'Onglet invalide ou non désactivable' }, 400);
  }
  const commune_id = c.get('commune_id');

  const schema = z.object({ actif: z.boolean() });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [existant] = await supabaseSelect(c.env, 'onglets_config', {
    select: 'id', commune_id: `eq.${commune_id}`, cle: `eq.${cle}`,
  });

  if (existant) {
    await supabaseUpdate(c.env, 'onglets_config', { actif: body.data.actif }, {
      commune_id: `eq.${commune_id}`, cle: `eq.${cle}`,
    });
  } else {
    // Aucune ligne encore créée pour cet onglet (nouveau module) : on la crée à la volée.
    await supabaseInsert(c.env, 'onglets_config', {
      commune_id, cle, actif: body.data.actif,
    });
  }

  return c.json({ ok: true });
});

// GET /moderation/utilisateurs — liste des membres de la commune (élu/superadmin uniquement)
app.get('/utilisateurs', async (c) => {
  const role = c.get('role');
  if (!peutGererRoles(role)) {
    return c.json({ erreur: 'Réservé aux élus, au maire et au superadmin' }, 403);
  }
  const commune_id = c.get('commune_id');
  const utilisateurs = await supabaseSelect(c.env, 'users', {
    select: 'id,nom,prenom,email,role',
    commune_id: `eq.${commune_id}`,
    order: 'prenom.asc',
  });
  return c.json({ utilisateurs });
});

// PATCH /moderation/utilisateurs/:id/role — attribution de rôle, hiérarchie stricte
app.patch('/utilisateurs/:id/role', async (c) => {
  const roleAppelant = c.get('role');
  const appelantId = c.get('user_id');
  const commune_id = c.get('commune_id');
  const cibleId = c.req.param('id');

  if (!peutGererRoles(roleAppelant)) {
    return c.json({ erreur: 'Réservé aux élus, au maire et au superadmin' }, 403);
  }
  if (cibleId === appelantId) {
    return c.json({ erreur: 'Impossible de modifier son propre rôle' }, 400);
  }

  const schema = z.object({ role: z.enum(['citoyen', 'admin', 'elu', 'maire']) });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [cible] = await supabaseSelect(c.env, 'users', {
    select: 'id,role', commune_id: `eq.${commune_id}`, id: `eq.${cibleId}`,
  });
  if (!cible) return c.json({ erreur: 'Utilisateur introuvable' }, 404);

  const verification = peutAttribuerRole(roleAppelant, cible.role, body.data.role);
  if (!verification.ok) {
    return c.json({ erreur: verification.erreur }, 403);
  }

  await supabaseUpdate(c.env, 'users', { role: body.data.role }, {
    id: `eq.${cibleId}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
});

// ── Badges citoyens — pilotés en base, réservés au superadmin. Système séparé des badges
// existants (codés en dur dans worker/src/lib/gamification.ts), qui restent inchangés. ──

const badgeCreationSchema = z.object({
  cle: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, 'Minuscules, chiffres et underscores uniquement'),
  nom: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['seuil', 'evenement']),
  declencheur: z.enum(DECLENCHEURS_BADGE_VALIDES),
  valeur_seuil: z.number().int().positive().optional(),
  visuel_url: z.string().optional(),
  r2_key: z.string().optional(),
});
const badgeModificationSchema = badgeCreationSchema.partial().extend({
  actif: z.boolean().optional(),
  ordre: z.number().int().min(0).optional(),
});

app.get('/badges-citoyens', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') return c.json({ erreur: 'Réservé au superadmin' }, 403);
  const commune_id = c.get('commune_id');

  const badges = await supabaseSelect(c.env, 'badges_citoyens', {
    select: 'id,cle,nom,description,type,declencheur,valeur_seuil,visuel_url,actif,ordre',
    commune_id: `eq.${commune_id}`, order: 'ordre.asc',
  });
  return c.json({ badges });
});

app.post('/badges-citoyens', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') return c.json({ erreur: 'Réservé au superadmin' }, 403);
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = badgeCreationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const dernier = await supabaseSelect(c.env, 'badges_citoyens', {
    select: 'ordre', commune_id: `eq.${commune_id}`, order: 'ordre.desc', limit: '1',
  });
  const ordre = (dernier[0]?.ordre ?? -1) + 1;

  const [badge] = await supabaseInsert(c.env, 'badges_citoyens', {
    commune_id, cle: data.cle, nom: data.nom, description: data.description ?? null,
    type: data.type, declencheur: data.declencheur, valeur_seuil: data.valeur_seuil ?? null,
    visuel_url: data.visuel_url ?? null, r2_key: data.r2_key ?? null,
    actif: true, ordre, cree_par: user_id,
  });

  return c.json({ badge_id: badge.id }, 201);
});

// PATCH sert aussi le réordonnancement (le front envoie juste { ordre } pour ▲/▼).
app.patch('/badges-citoyens/:id', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') return c.json({ erreur: 'Réservé au superadmin' }, 403);
  const commune_id = c.get('commune_id');
  const badge_id = c.req.param('id');

  const body = badgeModificationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const patch: Record<string, unknown> = {};
  if (data.nom !== undefined) patch.nom = data.nom;
  if (data.description !== undefined) patch.description = data.description;
  if (data.type !== undefined) patch.type = data.type;
  if (data.declencheur !== undefined) patch.declencheur = data.declencheur;
  if (data.valeur_seuil !== undefined) patch.valeur_seuil = data.valeur_seuil;
  if (data.visuel_url !== undefined) patch.visuel_url = data.visuel_url;
  if (data.r2_key !== undefined) patch.r2_key = data.r2_key;
  if (data.actif !== undefined) patch.actif = data.actif;
  if (data.ordre !== undefined) patch.ordre = data.ordre;

  if (Object.keys(patch).length === 0) return c.json({ erreur: 'Aucun champ à modifier' }, 400);

  await supabaseUpdate(c.env, 'badges_citoyens', patch, { id: `eq.${badge_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

app.delete('/badges-citoyens/:id', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') return c.json({ erreur: 'Réservé au superadmin' }, 403);
  const commune_id = c.get('commune_id');
  const badge_id = c.req.param('id');

  const [dejaDebloque] = await supabaseSelect(c.env, 'user_badges_citoyens', {
    select: 'id', commune_id: `eq.${commune_id}`, badge_id: `eq.${badge_id}`, limit: '1',
  });
  if (dejaDebloque) {
    return c.json({ erreur: 'Ce badge a déjà été débloqué par des citoyens — désactivez-le plutôt que de le supprimer.' }, 400);
  }

  await supabaseDelete(c.env, 'badges_citoyens', { id: `eq.${badge_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

app.post('/badges-citoyens/upload', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') return c.json({ erreur: 'Réservé au superadmin' }, 403);
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp|svg\+xml)$/.test(contentType)) {
    return c.json({ erreur: 'Type de fichier non autorisé (jpeg/png/webp/svg uniquement)' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 4 * 1024 * 1024) {
    return c.json({ erreur: 'Image trop lourde (max 4 Mo)' }, 400);
  }
  const extension = contentType.split('/')[1].replace('svg+xml', 'svg');
  const key = `${commune_id}/badges-citoyens/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

// File de contestations (présences "non confirmées" contestées par le citoyen) — le
// superadmin les résout en validant (route agenda.ts) ou en rejetant la contestation.
app.get('/audits-citoyens', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') return c.json({ erreur: 'Réservé au superadmin' }, 403);
  const commune_id = c.get('commune_id');

  const contestations = await supabaseSelect(c.env, 'participations_citoyennes', {
    select: 'id,event_id,user_id,statut,contestee_le',
    commune_id: `eq.${commune_id}`, contestee_le: 'not.is.null', order: 'contestee_le.desc',
  });

  const idsEvents = [...new Set(contestations.map((p: any) => p.event_id))];
  const idsUsers = [...new Set(contestations.map((p: any) => p.user_id))];
  const [events, utilisateurs] = await Promise.all([
    idsEvents.length ? supabaseSelect(c.env, 'events', { select: 'id,titre', commune_id: `eq.${commune_id}`, id: `in.(${idsEvents.join(',')})` }) : [],
    idsUsers.length ? supabaseSelect(c.env, 'users', { select: 'id,prenom,nom', commune_id: `eq.${commune_id}`, id: `in.(${idsUsers.join(',')})` }) : [],
  ]);

  const contestationsEnrichies = contestations.map((p: any) => ({
    ...p,
    titre_event: events.find((e: any) => e.id === p.event_id)?.titre ?? '?',
    prenom: utilisateurs.find((u: any) => u.id === p.user_id)?.prenom ?? '?',
    nom: utilisateurs.find((u: any) => u.id === p.user_id)?.nom ?? '',
  }));

  return c.json({ contestations: contestationsEnrichies });
});

// GET /stats — vue d'ensemble de la commune, en tête de l'onglet Modération. Comptages à la
// volée (select:'id' + .length) plutôt qu'un compteur persistant à maintenir : cohérent avec
// compterContributionsActives (worker/src/routes/profil.ts), même logique "encore actif" pour
// le contenu éphémère déjà purgé.
app.get('/stats', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const compter = (table: string, filtresSupp: Record<string, string> = {}) =>
    supabaseSelect(c.env, table, { select: 'id', commune_id: `eq.${commune_id}`, ...filtresSupp }).then((r: any[]) => r.length);

  const [
    citoyens, articles, alertesOuvertes, alertesEnCours, alertesResolues, sondages, messagesMur,
    evenementsAVenir, annonces, fichesAnnuaire, chassesActives, enigmesActives, photosJour,
    avisLois, enAttentePhotos, enAttenteEnigmes, enAttenteMur, scoresCitoyens,
  ] = await Promise.all([
    compter('users'),
    compter('articles', { section: 'eq.actualites' }),
    compter('alertes', { statut: 'eq.ouverte' }),
    compter('alertes', { statut: 'eq.en_cours' }),
    compter('alertes', { statut: 'eq.resolue' }),
    compter('sondages'),
    compter('posts', { statut: 'eq.visible' }),
    compter('events', { date_debut: `gt.${new Date().toISOString()}` }),
    compter('coups_de_main'),
    compter('annuaire'),
    compter('chasses_tresor', { actif: 'eq.true' }),
    compter('photos_enigmes', { statut: 'eq.visible' }),
    compter('photos_du_jour', { statut: 'eq.visible' }),
    compter('lois_commentaires'),
    compter('photos_du_jour', { statut: 'eq.masquee' }),
    compter('photos_enigmes', { statut: 'eq.masquee' }),
    compter('posts', { statut: 'eq.masquee' }),
    supabaseSelect(c.env, 'users', { select: 'score_citoyen', commune_id: `eq.${commune_id}` }),
  ]);

  const score_citoyen_total = scoresCitoyens.reduce((total: number, u: any) => total + (u.score_citoyen ?? 0), 0);

  return c.json({
    citoyens, articles,
    alertes_en_cours: alertesOuvertes + alertesEnCours, alertes_resolues: alertesResolues,
    sondages, messages_mur: messagesMur, evenements_a_venir: evenementsAVenir,
    annonces_entraide: annonces, fiches_annuaire: fichesAnnuaire,
    explorations_actives: chassesActives + enigmesActives,
    photos_jour: photosJour, avis_lois: avisLois,
    en_attente_moderation: enAttentePhotos + enAttenteEnigmes + enAttenteMur,
    score_citoyen_total,
  });
});

// GET /stats-connexions — fréquentation de l'app. Les compteurs "actifs" viennent de la
// dernière connexion de chaque habitant (users.derniere_connexion_streak) — disponibles tout
// de suite ; la série quotidienne vient du journal connexions_journalieres, qui se remplit à
// partir de sa mise en service (pas d'historique rétroactif).
app.get('/stats-connexions', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const jourISO = (decalage: number) => {
    const d = new Date();
    d.setDate(d.getDate() - decalage);
    return d.toISOString().slice(0, 10);
  };
  const aujourdhui = jourISO(0);
  const il7 = jourISO(6);
  const il30 = jourISO(29);

  const [commune, users, connexions] = await Promise.all([
    supabaseSelect(c.env, 'communes', { select: 'population', id: `eq.${commune_id}` }),
    supabaseSelect(c.env, 'users', { select: 'derniere_connexion_streak', commune_id: `eq.${commune_id}` }),
    // limite haute : à l'échelle d'un village, 30 jours de connexions tiennent largement dessous.
    supabaseSelect(c.env, 'connexions_journalieres', {
      select: 'jour', commune_id: `eq.${commune_id}`, jour: `gte.${il30}`, limit: '5000',
    }),
  ]);

  const actifsDepuis = (seuil: string) =>
    users.filter((u: any) => u.derniere_connexion_streak && u.derniere_connexion_streak >= seuil).length;

  const parJour: Record<string, number> = {};
  for (const row of connexions) parJour[row.jour] = (parJour[row.jour] ?? 0) + 1;
  const serie: { jour: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const jour = jourISO(i);
    serie.push({ jour, count: parJour[jour] ?? 0 });
  }

  return c.json({
    population: commune[0]?.population ?? null,
    inscrits: users.length,
    actifs_aujourdhui: users.filter((u: any) => u.derniere_connexion_streak === aujourdhui).length,
    actifs_semaine: actifsDepuis(il7),
    actifs_mois: actifsDepuis(il30),
    serie,
  });
});

export default app;

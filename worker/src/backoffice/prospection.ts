// worker/src/backoffice/prospection.ts
// Phase 2 du backoffice : prospection commerciale des communes françaises à partir de l'open
// data officiel (aucune clé, aucun navigateur headless) :
//  - geo.api.gouv.fr        → liste des communes d'un département (nom, INSEE, CP, population)
//  - api-lannuaire (service-public) → contact mairie (email, téléphone, adresse, site)
// Toutes les routes sont derrière backofficeMiddleware (périmètre staff transverse).
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseInsert, supabaseUpdate, supabaseCount } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { envoyerPresentation, contextePresentation, genererMotDePasseTemporaire } from './email-commune';
import { chargerOngletsGratuits, appliquerOngletsSurCommune } from './administration';
import { hasherMotDePasse } from '../lib/password';
import { versCsv } from '../lib/csv';

const app = new Hono();
app.use('*', backofficeMiddleware);

const STATUTS = ['a_contacter', 'contacte', 'relance', 'rdv', 'gagne', 'perdu'] as const;
const TYPES_INTERACTION = ['note', 'appel', 'email', 'courrier', 'rdv'] as const;

// — Import depuis geo.api.gouv.fr —
const importSchema = z.object({
  departement: z.string().regex(/^(\d{2,3}|2[ab])$/i),  // 01-976, Corse 2A/2B
  population_max: z.number().int().positive().optional(),
});

app.post('/importer', async (c) => {
  const body = importSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const { departement, population_max } = body.data;
  const dep = departement.toUpperCase();

  const url = `https://geo.api.gouv.fr/departements/${dep}/communes?fields=nom,code,codesPostaux,population&format=json`;
  const res = await fetch(url);
  if (!res.ok) return c.json({ erreur: `Département introuvable ou source indisponible (${res.status})` }, 502);
  const communes: any[] = await res.json();

  const retenues = communes.filter((cm) => population_max == null || (cm.population ?? 0) <= population_max);

  // On n'insère que les code_insee absents : jamais d'écrasement d'un prospect déjà travaillé
  // (statut, notes, relances conservés).
  const existants = await supabaseSelect(c.env, 'prospects', {
    select: 'code_insee', departement: `eq.${dep}`,
  });
  const dejaPresents = new Set(existants.map((p: any) => p.code_insee));

  const nouveaux = retenues
    .filter((cm) => cm.code && !dejaPresents.has(cm.code))
    .map((cm) => ({
      code_insee: cm.code,
      nom: cm.nom,
      code_postal: Array.isArray(cm.codesPostaux) ? cm.codesPostaux[0] ?? null : null,
      departement: dep,
      population: cm.population ?? null,
    }));

  if (nouveaux.length > 0) await supabaseInsert(c.env, 'prospects', nouveaux);

  return c.json({ ok: true, importes: nouveaux.length, deja_presents: retenues.length - nouveaux.length });
});

// — Liste (filtres sobres : statut, département, recherche) —
const TRIS: Record<string, string> = {
  nom: 'nom.asc',
  departement: 'departement.asc,nom.asc',
  population_desc: 'population.desc.nullslast',
  population_asc: 'population.asc.nullslast',
};

const TAILLE_PAGE_PROSPECTS = 100;

app.get('/prospects', async (c) => {
  // Filtres communs à la liste ET au comptage total (pagination).
  const where: Record<string, string> = {};
  const statut = c.req.query('statut');
  const departement = c.req.query('departement');
  const recherche = c.req.query('recherche');
  if (statut && STATUTS.includes(statut as any)) where.statut = `eq.${statut}`;
  if (departement) where.departement = `eq.${departement.toUpperCase()}`;
  if (recherche) where.nom = `ilike.*${recherche}*`;

  const tri = c.req.query('tri');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const offset = (page - 1) * TAILLE_PAGE_PROSPECTS;

  const [prospects, total] = await Promise.all([
    supabaseSelect(c.env, 'prospects', {
      ...where,
      select: 'id,code_insee,nom,departement,population,statut,contact_email,email_invalide,prochaine_relance_le',
      order: (tri && TRIS[tri]) || TRIS.nom,
      limit: String(TAILLE_PAGE_PROSPECTS),
      offset: String(offset),
    }),
    supabaseCount(c.env, 'prospects', where),
  ]);

  return c.json({ prospects, page, taille: TAILLE_PAGE_PROSPECTS, total });
});

// GET /prospects-export.csv — mêmes filtres que la liste (statut/departement/recherche), mais
// sans pagination : tout ce qui correspond, pour sauvegarde/analyse externe.
app.get('/prospects-export.csv', async (c) => {
  const where: Record<string, string> = {};
  const statut = c.req.query('statut');
  const departement = c.req.query('departement');
  const recherche = c.req.query('recherche');
  if (statut && STATUTS.includes(statut as any)) where.statut = `eq.${statut}`;
  if (departement) where.departement = `eq.${departement.toUpperCase()}`;
  if (recherche) where.nom = `ilike.*${recherche}*`;

  const prospects = await supabaseSelect(c.env, 'prospects', {
    ...where,
    select: 'nom,departement,population,statut,contact_email,contact_telephone,site_web,prochaine_relance_le,created_at',
    order: 'nom.asc', limit: '20000',
  });
  const csv = versCsv(prospects, [
    { cle: 'nom', titre: 'Commune' }, { cle: 'departement', titre: 'Département' },
    { cle: 'population', titre: 'Population' }, { cle: 'statut', titre: 'Statut' },
    { cle: 'contact_email', titre: 'Email' }, { cle: 'contact_telephone', titre: 'Téléphone' },
    { cle: 'site_web', titre: 'Site web' }, { cle: 'prochaine_relance_le', titre: 'Prochaine relance' },
    { cle: 'created_at', titre: 'Ajouté le' },
  ]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="prospects-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// GET /prospects/candidats-rattrapage — liste légère (id + nom) des prospects déjà contactés
// AVANT la mise en place de l'activation automatique (2026-08-17), donc toujours sans commune.
// Le rattrapage lui-même se fait ENSUITE côté client, un appel à POST /prospects/:id/prospecter
// à la fois (voir frontend/backoffice/js/app.js, rattraperActivation) — délibérément PAS un
// traitement en lot côté Worker : cumuler plusieurs activations (annuaire + Supabase + Resend +
// hachage PBKDF2 par prospect) dans UNE SEULE invocation s'est révélé intermittent (limite de
// temps/CPU cumulée, non rattrapable par un simple try/catch côté code). Un appel par prospect
// hérite de la fiabilité déjà éprouvée du bouton d'envoi unitaire.
// IMPORTANT : doit rester déclarée AVANT GET /prospects/:id ci-dessous, sinon Hono matche
// « candidats-rattrapage » comme un :id et la requête échoue (bug déjà rencontré le 2026-08-17).
app.get('/prospects/candidats-rattrapage', async (c) => {
  const candidats = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom', commune_id: 'is.null', statut: 'in.(contacte,relance,rdv)', order: 'nom.asc', limit: '500',
  });
  return c.json({ candidats });
});

// — Carte : uniquement les prospects géolocalisés (lat renseignée). Se remplit au fil de
//   l'enrichissement. Filtre département optionnel. —
app.get('/carte', async (c) => {
  const filtres: Record<string, string> = {
    select: 'id,nom,statut,lat,lng,departement',
    lat: 'not.is.null',
  };
  const departement = c.req.query('departement');
  if (departement) filtres.departement = `eq.${departement.toUpperCase()}`;
  const prospects = await supabaseSelect(c.env, 'prospects', filtres);
  return c.json({ prospects });
});

// — Aperçu : compteurs par statut + relances dues aujourd'hui —
app.get('/apercu', async (c) => {
  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'statut,prochaine_relance_le,commune_id', limit: '20000',
  });
  const parStatut: Record<string, number> = {};
  for (const s of STATUTS) parStatut[s] = 0;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  let a_relancer = 0;
  // Contactés (au sens large : ont reçu au moins une présentation) mais toujours sans commune
  // réelle — ce que traite « Activer et renvoyer ». Distingué de ceux déjà activés, pour
  // vérifier précisément l'avancement du rattrapage plutôt que de se fier à un seul message.
  let contactes_sans_commune = 0;
  let contactes_avec_commune = 0;
  const STATUTS_CONTACTES = ['contacte', 'relance', 'rdv'];
  for (const p of prospects) {
    parStatut[p.statut] = (parStatut[p.statut] ?? 0) + 1;
    if (p.prochaine_relance_le && p.prochaine_relance_le <= aujourdhui &&
        p.statut !== 'gagne' && p.statut !== 'perdu') a_relancer += 1;
    if (STATUTS_CONTACTES.includes(p.statut)) {
      if (p.commune_id) contactes_avec_commune += 1;
      else contactes_sans_commune += 1;
    }
  }
  return c.json({
    total: prospects.length, par_statut: parStatut, a_relancer,
    contactes_sans_commune, contactes_avec_commune,
  });
});

// — Fiche + timeline —
app.get('/prospects/:id', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,code_insee,nom,code_postal,departement,population,statut,contact_email,contact_telephone,site_web,adresse,notes,prochaine_relance_le,enrichi_le,commune_id,created_at',
    id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const interactions = await supabaseSelect(c.env, 'prospect_interactions', {
    select: 'type,contenu,created_at', prospect_id: `eq.${id}`, order: 'created_at.desc',
  });
  return c.json({ prospect, interactions });
});

// — Enrichissement contact via l'annuaire (une seule commune à la fois : léger) —
export function premiereValeur(champJson: string | null | undefined): string | null {
  if (!champJson) return null;
  try {
    const arr = JSON.parse(champJson);
    return Array.isArray(arr) && arr[0]?.valeur ? arr[0].valeur : null;
  } catch { return null; }
}

export function formaterAdresse(champJson: string | null | undefined): string | null {
  if (!champJson) return null;
  try {
    const a = JSON.parse(champJson)?.[0];
    if (!a) return null;
    return [a.numero_voie, a.complement1, `${a.code_postal ?? ''} ${a.nom_commune ?? ''}`.trim()]
      .filter(Boolean).join(', ') || null;
  } catch { return null; }
}

// Coordonnées [lng, lat] depuis l'adresse annuaire (les champs y sont des chaînes). null si absent.
export function coordsDepuisAdresse(champJson: string | null | undefined): { lat: number; lng: number } | null {
  if (!champJson) return null;
  try {
    const a = JSON.parse(champJson)?.[0];
    const lat = parseFloat(a?.latitude);
    const lng = parseFloat(a?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  } catch { /* ignore */ }
  return null;
}

// Récupère le contact mairie depuis l'annuaire, met à jour le prospect et renvoie la ligne à
// jour. Renvoie null si l'annuaire n'a pas de fiche. Partagé par /enrichir, /prospecter et la
// correction automatique des emails invalides (bounces Resend, voir corrigerEmailsInvalides).
// Une adresse fraîche et DIFFÉRENTE de celle qui avait fait rejeter le mail lève le flag
// email_invalide : elle mérite un nouvel essai. Si l'annuaire renvoie la même adresse (ou rien),
// le flag reste posé — pas de nouvel envoi tant qu'on n'a pas une piste différente.
async function enrichirDepuisAnnuaire(
  env: any,
  prospect: { id: string; code_insee: string; contact_email?: string | null; email_invalide?: boolean },
): Promise<any | null> {
  const url = `https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records`
    + `?where=${encodeURIComponent(`pivot like "mairie" and code_insee_commune="${prospect.code_insee}"`)}`
    + `&select=nom,adresse_courriel,telephone,adresse,site_internet&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const fiche = ((await res.json()) as any)?.results?.[0];
  if (!fiche) return null;

  const nouvelEmail = fiche.adresse_courriel || null;
  const coords = coordsDepuisAdresse(fiche.adresse);
  const patch: Record<string, unknown> = {
    contact_email: nouvelEmail,
    contact_telephone: premiereValeur(fiche.telephone),
    site_web: premiereValeur(fiche.site_internet),
    adresse: formaterAdresse(fiche.adresse),
    enrichi_le: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Coordonnées récupérées « gratuitement » depuis l'annuaire : alimentent la carte au fil de l'eau.
  if (coords) { patch.lat = coords.lat; patch.lng = coords.lng; }
  if (prospect.email_invalide && nouvelEmail && nouvelEmail !== prospect.contact_email) {
    patch.email_invalide = false;
  }
  const [maj] = await supabaseUpdate(env, 'prospects', patch, { id: `eq.${prospect.id}` });
  return maj;
}

app.post('/prospects/:id/enrichir', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,code_insee,contact_email,email_invalide', id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const maj = await enrichirDepuisAnnuaire(c.env, prospect);
  if (!maj) return c.json({ erreur: 'Aucune mairie trouvée dans l\'annuaire pour cette commune' }, 404);
  return c.json({ ok: true, prospect: maj });
});

// Correction en masse des emails invalides (bounces Resend) : retente l'annuaire pour chaque
// prospect flagué email_invalide, dans l'espoir d'une adresse plus à jour que celle qui a
// rejeté. Partagé par le bouton backoffice et le cron quotidien (voir worker/src/cron.ts).
// Plafonné à 300 par passage : léger, un rattrapage suffit largement d'un jour sur l'autre.
export async function corrigerEmailsInvalides(env: any): Promise<{ corriges: number; inchanges: number }> {
  const prospects = await supabaseSelect(env, 'prospects', {
    select: 'id,code_insee,contact_email,email_invalide', email_invalide: 'eq.true', limit: '300',
  });
  let corriges = 0, inchanges = 0;
  for (const prospect of prospects) {
    const maj = await enrichirDepuisAnnuaire(env, prospect);
    if (maj && maj.email_invalide === false) corriges += 1;
    else inchanges += 1;
  }
  return { corriges, inchanges };
}

app.post('/prospects/corriger-emails-invalides', async (c) => {
  const r = await corrigerEmailsInvalides(c.env);
  return c.json({ ok: true, ...r });
});

// GET /stats-variantes — entonnoir envoyé → ouvert → cliqué → rejeté, par variante A/B, plus le
// signal le plus fiable de tous : le maire s'est-il RÉELLEMENT connecté au moins une fois à la
// commune activée (users.derniere_connexion_streak). Approximatif si un même prospect a reçu
// plusieurs envois sous des variantes différentes (la connexion est alors comptée pour chacune) —
// acceptable pour un funnel indicatif, pas un système de stats exhaustif.
app.get('/stats-variantes', async (c) => {
  const envois = await supabaseSelect(c.env, 'envois_prospection', {
    select: 'prospect_id,variante,ouvert_le,clique_le,rejete_le', est_test: 'eq.false', limit: '20000',
  });

  const prospectIds = [...new Set(envois.map((e: any) => e.prospect_id).filter(Boolean))];
  const prospectCommune = new Map<string, string>();
  if (prospectIds.length) {
    const prospects = await supabaseSelect(c.env, 'prospects', {
      select: 'id,commune_id', id: `in.(${prospectIds.join(',')})`,
    });
    for (const p of prospects) if (p.commune_id) prospectCommune.set(p.id, p.commune_id);
  }

  const communeIds = [...new Set(prospectCommune.values())];
  const communesConnectees = new Set<string>();
  if (communeIds.length) {
    const maires = await supabaseSelect(c.env, 'users', {
      select: 'commune_id,derniere_connexion_streak', role: 'eq.maire', commune_id: `in.(${communeIds.join(',')})`,
    });
    for (const m of maires) if (m.derniere_connexion_streak) communesConnectees.add(m.commune_id);
  }

  const parVariante: Record<string, { envoyes: number; ouverts: number; cliques: number; rejetes: number; connectes: number }> = {};
  for (const e of envois) {
    const cle = e.variante || '(sans nom)';
    const v = (parVariante[cle] ??= { envoyes: 0, ouverts: 0, cliques: 0, rejetes: 0, connectes: 0 });
    v.envoyes += 1;
    if (e.ouvert_le) v.ouverts += 1;
    if (e.clique_le) v.cliques += 1;
    if (e.rejete_le) v.rejetes += 1;
    const communeId = e.prospect_id ? prospectCommune.get(e.prospect_id) : undefined;
    if (communeId && communesConnectees.has(communeId)) v.connectes += 1;
  }

  const variantes = Object.entries(parVariante)
    .map(([nom, v]) => ({ nom, ...v }))
    .sort((a, b) => b.envoyes - a.envoyes);
  return c.json({ variantes });
});

// — Slug unique pour une commune créée automatiquement (accents/majuscules retirés, dédoublonné
//   par suffixe numérique). Partagé avec la logique d'activation ci-dessous. —
function genererSlugBase(nom: string): string {
  return nom
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'commune';
}

async function genererSlugUnique(env: any, nom: string): Promise<string> {
  const base = genererSlugBase(nom);
  const existants = await supabaseSelect(env, 'communes', { select: 'slug', slug: `like.${base}*` });
  const pris = new Set(existants.map((c: any) => c.slug));
  if (!pris.has(base)) return base;
  let n = 2;
  while (pris.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Active une VRAIE commune gratuite pour ce prospect s'il n'en a pas déjà une (plus de démo
// partagée), et (re)génère un mot de passe provisoire pour son compte maire à CHAQUE envoi — un
// prospect encore en cours de prospection n'a pas de mot de passe « définitif » à préserver ;
// une fois « gagné », ce flux n'est plus jamais appelé (voir prospecterUn, qui court-circuite
// avant). Décision business du 2026-08-17 : zéro friction, chaque prospect reçoit son propre
// espace fonctionnel dès le premier envoi de présentation, gratuitement.
async function activerCommuneGratuite(env: any, prospect: any): Promise<{ slug: string; maireEmail: string; motDePasse: string }> {
  let communeId: string = prospect.commune_id || '';

  if (!communeId) {
    const slug = await genererSlugUnique(env, prospect.nom);
    const [commune] = await supabaseInsert(env, 'communes', {
      nom: prospect.nom, slug,
      population: prospect.population ?? null,
      lat: prospect.lat ?? null, lng: prospect.lng ?? null,
      forfait: 'Gratuit', niveau_national: false,
    });
    communeId = commune.id;
    await appliquerOngletsSurCommune(env, communeId, await chargerOngletsGratuits(env));
    await supabaseUpdate(env, 'prospects', { commune_id: communeId }, { id: `eq.${prospect.id}` });
  }

  const [communeActuelle] = await supabaseSelect(env, 'communes', { select: 'slug', id: `eq.${communeId}` });

  const motDePasse = genererMotDePasseTemporaire();
  const [maire] = await supabaseSelect(env, 'users', {
    select: 'id,email', commune_id: `eq.${communeId}`, role: 'eq.maire', order: 'created_at.asc',
  });
  let maireEmail: string;
  if (maire) {
    maireEmail = maire.email;
    await supabaseUpdate(env, 'users', { password_hash: await hasherMotDePasse(motDePasse) }, { id: `eq.${maire.id}` });
  } else {
    maireEmail = prospect.contact_email;
    await supabaseInsert(env, 'users', {
      commune_id: communeId, email: maireEmail, password_hash: await hasherMotDePasse(motDePasse),
      prenom: 'Maire de', nom: prospect.nom, role: 'maire',
      consentement_rgpd_le: new Date().toISOString(),
    });
  }

  return { slug: communeActuelle.slug, maireEmail, motDePasse };
}

// — Prospecter en un clic : enrichit si besoin, active une commune gratuite pour le prospect
//   (s'il n'en a pas déjà une), envoie l'email de présentation avec ses identifiants, journalise
//   l'échange, passe le statut à « contacté » et pose une relance à +7 jours. —
// Traite un prospect : enrichit si besoin, envoie l'email, journalise, met à jour statut/relance.
// Partagé par l'envoi unitaire et l'envoi groupé. Ne jette jamais : renvoie l'issue.
async function prospecterUn(env: any, staffId: string, prospect: any): Promise<{ resultat: 'envoye' | 'sans_email' | 'saute'; email?: string }> {
  if (prospect.statut === 'gagne' || prospect.statut === 'perdu') return { resultat: 'saute' };

  let email = prospect.contact_email;
  let emailInvalide = prospect.email_invalide;
  // Adresse manquante OU connue pour avoir rejeté (bounce Resend) : on retente l'annuaire avant
  // d'abandonner. Protège la réputation d'expéditeur — on ne renvoie jamais aveuglément sur une
  // adresse déjà signalée fautive.
  if (!email || emailInvalide) {
    const maj = await enrichirDepuisAnnuaire(env, prospect);
    if (maj) { email = maj.contact_email; emailInvalide = maj.email_invalide; }
  }
  if (!email || emailInvalide) return { resultat: 'sans_email' };

  const nouvelleActivation = !prospect.commune_id;
  const activation = await activerCommuneGratuite(env, { ...prospect, contact_email: email });
  const ctx = contextePresentation(env.FRONTEND_URL, prospect.nom, activation.slug);
  const { variante, resendEmailId } = await envoyerPresentation(env, email, ctx, {
    maireEmail: activation.maireEmail, motDePasse: activation.motDePasse,
  });

  // Ligne dédiée au suivi structuré (ouverture/clic/rejet via webhook Resend, voir index.ts et
  // migration 040) — resend_email_id permet une corrélation précise, contrairement à un simple
  // match par adresse email qui serait ambigu en cas d'envois successifs au même contact.
  if (resendEmailId) {
    await supabaseInsert(env, 'envois_prospection', {
      prospect_id: prospect.id, resend_email_id: resendEmailId, email, variante,
    });
  }

  const relance = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), prochaine_relance_le: relance };
  if (prospect.statut === 'a_contacter') patch.statut = 'contacte';
  await supabaseUpdate(env, 'prospects', patch, { id: `eq.${prospect.id}` });

  // Trace la variante utilisée (A/B testing) et l'activation éventuelle dans l'historique lisible
  // du prospect (distinct du suivi structuré ci-dessus, qui alimente les stats agrégées).
  await supabaseInsert(env, 'prospect_interactions', {
    prospect_id: prospect.id, staff_id: staffId,
    type: 'email',
    contenu: `Email de présentation envoyé à ${email}${variante ? ` (variante : ${variante})` : ''}`
      + (nouvelleActivation ? ` — commune activée gratuitement (${activation.slug})` : ''),
  });
  return { resultat: 'envoye', email };
}

app.post('/prospects/:id/prospecter', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,commune_id', id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const r = await prospecterUn(c.env, c.get('staff_id'), prospect);
  if (r.resultat === 'sans_email') return c.json({ erreur: 'Aucun email valide pour cette commune (adresse manquante, ou signalée en échec et non corrigée par l\'annuaire).' }, 422);
  if (r.resultat === 'saute') return c.json({ erreur: 'Ce prospect est déjà gagné ou perdu.' }, 400);
  return c.json({ ok: true, email: r.email });
});

// Traite un lot de prospects en séquence, SANS jamais laisser l'échec d'un seul (données
// inattendues, timeout annuaire, etc.) interrompre les suivants ni faire planter toute la
// requête (500 opaque côté backoffice) — chaque prospect est isolé dans son propre try/catch.
async function traiterLot(env: any, staffId: string, prospects: any[]): Promise<{ envoyes: number; sans_email: number; ignores: number; erreurs: number }> {
  let envoyes = 0, sans_email = 0, ignores = 0, erreurs = 0;
  for (const prospect of prospects) {
    try {
      const r = await prospecterUn(env, staffId, prospect);
      if (r.resultat === 'envoye') envoyes += 1;
      else if (r.resultat === 'sans_email') sans_email += 1;
      else ignores += 1;
    } catch (err) {
      console.error(`prospecterUn a échoué pour le prospect ${prospect.id} (${prospect.nom}) :`, err);
      erreurs += 1;
    }
  }
  return { envoyes, sans_email, ignores, erreurs };
}

// — Envoi groupé : prospecte plusieurs communes sélectionnées en une fois. Plafonné (limites
//   Resend + sous-requêtes Worker + délivrabilité) et traité en séquence. —
const lotSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(40) });

app.post('/prospecter-lot', async (c) => {
  const body = lotSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Sélection invalide (1 à 40 communes par envoi).' }, 400);

  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,commune_id',
    id: `in.(${body.data.ids.join(',')})`,
  });

  const r = await traiterLot(c.env, c.get('staff_id'), prospects);
  return c.json({ ok: true, ...r });
});

// PATCH /prospects/statut-lot — change le statut de plusieurs prospects d'un coup (ex. archiver
// en masse les perdus). Doit rester déclarée AVANT PATCH /prospects/:id ci-dessous, sinon Hono
// matche "statut-lot" comme un :id (même piège que candidats-rattrapage, voir plus haut).
const statutLotSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), statut: z.enum(STATUTS) });

app.patch('/prospects/statut-lot', async (c) => {
  const body = statutLotSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Sélection ou statut invalide (1 à 200 prospects).' }, 400);
  const staffId = c.get('staff_id');

  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,statut', id: `in.(${body.data.ids.join(',')})`,
  });

  let modifies = 0;
  for (const prospect of prospects) {
    if (prospect.statut === body.data.statut) continue;
    await supabaseUpdate(c.env, 'prospects', { statut: body.data.statut, updated_at: new Date().toISOString() }, { id: `eq.${prospect.id}` });
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id: prospect.id, staff_id: staffId,
      type: 'statut', contenu: `Statut : ${prospect.statut} → ${body.data.statut} (action groupée)`,
    });
    modifies += 1;
  }
  return c.json({ ok: true, modifies });
});

// — Mise à jour (statut, notes, relance). Un changement de statut est journalisé dans la timeline. —
const patchSchema = z.object({
  statut: z.enum(STATUTS).optional(),
  notes: z.string().max(5000).optional().nullable(),
  prochaine_relance_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

app.patch('/prospects/:id', async (c) => {
  const id = c.req.param('id');
  const body = patchSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  const [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'statut', id: `eq.${id}` });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.data.statut !== undefined) patch.statut = body.data.statut;
  if (body.data.notes !== undefined) patch.notes = body.data.notes;
  if (body.data.prochaine_relance_le !== undefined) patch.prochaine_relance_le = body.data.prochaine_relance_le;

  await supabaseUpdate(c.env, 'prospects', patch, { id: `eq.${id}` });

  if (body.data.statut && body.data.statut !== prospect.statut) {
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id: id, staff_id: c.get('staff_id'),
      type: 'statut', contenu: `Statut : ${prospect.statut} → ${body.data.statut}`,
    });
  }
  return c.json({ ok: true });
});

// — Ajout d'une interaction (relance manuelle : note, appel, email...) —
const interactionSchema = z.object({
  type: z.enum(TYPES_INTERACTION),
  contenu: z.string().min(1).max(5000),
});

app.post('/prospects/:id/interactions', async (c) => {
  const id = c.req.param('id');
  const body = interactionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'id', id: `eq.${id}` });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const [interaction] = await supabaseInsert(c.env, 'prospect_interactions', {
    prospect_id: id, staff_id: c.get('staff_id'),
    type: body.data.type, contenu: body.data.contenu,
  });
  await supabaseUpdate(c.env, 'prospects', { updated_at: new Date().toISOString() }, { id: `eq.${id}` });
  return c.json({ ok: true, interaction });
});

export default app;

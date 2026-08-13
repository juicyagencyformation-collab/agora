// worker/src/backoffice/prospection.ts
// Phase 2 du backoffice : prospection commerciale des communes françaises à partir de l'open
// data officiel (aucune clé, aucun navigateur headless) :
//  - geo.api.gouv.fr        → liste des communes d'un département (nom, INSEE, CP, population)
//  - api-lannuaire (service-public) → contact mairie (email, téléphone, adresse, site)
// Toutes les routes sont derrière backofficeMiddleware (périmètre staff transverse).
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { envoyerEmailProspection } from './email-commune';

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
app.get('/prospects', async (c) => {
  const filtres: Record<string, string> = {
    select: 'id,code_insee,nom,departement,population,statut,contact_email,prochaine_relance_le',
    order: 'nom.asc',
  };
  const statut = c.req.query('statut');
  const departement = c.req.query('departement');
  const recherche = c.req.query('recherche');
  if (statut && STATUTS.includes(statut as any)) filtres.statut = `eq.${statut}`;
  if (departement) filtres.departement = `eq.${departement.toUpperCase()}`;
  if (recherche) filtres.nom = `ilike.*${recherche}*`;

  const prospects = await supabaseSelect(c.env, 'prospects', filtres);
  return c.json({ prospects });
});

// — Aperçu : compteurs par statut + relances dues aujourd'hui —
app.get('/apercu', async (c) => {
  const prospects = await supabaseSelect(c.env, 'prospects', { select: 'statut,prochaine_relance_le' });
  const parStatut: Record<string, number> = {};
  for (const s of STATUTS) parStatut[s] = 0;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  let a_relancer = 0;
  for (const p of prospects) {
    parStatut[p.statut] = (parStatut[p.statut] ?? 0) + 1;
    if (p.prochaine_relance_le && p.prochaine_relance_le <= aujourdhui &&
        p.statut !== 'gagne' && p.statut !== 'perdu') a_relancer += 1;
  }
  return c.json({ total: prospects.length, par_statut: parStatut, a_relancer });
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

// Récupère le contact mairie depuis l'annuaire, met à jour le prospect et renvoie la ligne à
// jour. Renvoie null si l'annuaire n'a pas de fiche. Partagé par /enrichir et /prospecter.
async function enrichirDepuisAnnuaire(env: any, id: string, codeInsee: string): Promise<any | null> {
  const url = `https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records`
    + `?where=${encodeURIComponent(`pivot like "mairie" and code_insee_commune="${codeInsee}"`)}`
    + `&select=nom,adresse_courriel,telephone,adresse,site_internet&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const fiche = ((await res.json()) as any)?.results?.[0];
  if (!fiche) return null;

  const patch = {
    contact_email: fiche.adresse_courriel || null,
    contact_telephone: premiereValeur(fiche.telephone),
    site_web: premiereValeur(fiche.site_internet),
    adresse: formaterAdresse(fiche.adresse),
    enrichi_le: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const [maj] = await supabaseUpdate(env, 'prospects', patch, { id: `eq.${id}` });
  return maj;
}

app.post('/prospects/:id/enrichir', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'id,code_insee', id: `eq.${id}` });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const maj = await enrichirDepuisAnnuaire(c.env, id, prospect.code_insee);
  if (!maj) return c.json({ erreur: 'Aucune mairie trouvée dans l\'annuaire pour cette commune' }, 404);
  return c.json({ ok: true, prospect: maj });
});

// — Prospecter en un clic : enrichit si besoin, envoie l'email de présentation à la mairie,
//   journalise l'échange, passe le statut à « contacté » et pose une relance à +7 jours. —
app.post('/prospects/:id/prospecter', async (c) => {
  const id = c.req.param('id');
  let [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,statut', id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  // Enrichissement automatique si l'email de contact manque encore.
  if (!prospect.contact_email) {
    const maj = await enrichirDepuisAnnuaire(c.env, id, prospect.code_insee);
    if (maj) prospect = { ...prospect, ...maj };
  }
  if (!prospect.contact_email) {
    return c.json({ erreur: 'Aucun email de contact trouvé pour cette commune (annuaire incomplet).' }, 422);
  }

  await envoyerEmailProspection(c.env, {
    nomCommune: prospect.nom,
    contactEmail: prospect.contact_email,
    frontendUrl: c.env.FRONTEND_URL,
  });

  const relance = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), prochaine_relance_le: relance };
  if (prospect.statut === 'a_contacter') patch.statut = 'contacte';
  await supabaseUpdate(c.env, 'prospects', patch, { id: `eq.${id}` });

  await supabaseInsert(c.env, 'prospect_interactions', {
    prospect_id: id, staff_id: c.get('staff_id'),
    type: 'email', contenu: `Email de présentation envoyé à ${prospect.contact_email}`,
  });

  return c.json({ ok: true, email: prospect.contact_email, statut: patch.statut ?? prospect.statut, prochaine_relance_le: relance });
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

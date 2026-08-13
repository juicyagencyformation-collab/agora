// worker/src/backoffice/administration.ts
// Administration/suivi des communes clientes (Phase 1 du backoffice). Toutes les routes sont
// derrière backofficeMiddleware : accès staff transverse, pas de commune_id dans le jeton.
// On lit directement les tables existantes (communes, users, avis_application) et on calcule
// le stockage R2 réellement consommé par commune via le préfixe de clé `${commune_id}/`.
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseUpdate, supabaseInsert } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { hasherMotDePasse } from '../lib/password';
import {
  envoyerEmailBienvenue, genererMotDePasseTemporaire,
  envoyerPresentation, contextePresentation, chargerModelePresentation,
  MODELE_PRESENTATION_DEFAUT,
} from './email-commune';
import { uploaderFichier, deleteObject } from '../storage';

const STATUTS_CLIENT = ['active', 'suspendue', 'resiliee'] as const;

const app = new Hono();
app.use('*', backofficeMiddleware);

// Somme des octets stockés dans R2 sous le préfixe d'une commune. Toutes les clés d'upload du
// projet sont préfixées `${commune_id}/...` (voir storage.ts et les routes d'upload), donc un
// simple list préfixé donne la consommation exacte. On boucle sur le curseur car list() est
// paginé (1000 objets max par page).
async function calculerStockageR2(env: any, commune_id: string): Promise<{ octets: number; nb_fichiers: number }> {
  if (!env.BUCKET_R2) return { octets: 0, nb_fichiers: 0 };
  let octets = 0;
  let nb_fichiers = 0;
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET_R2.list({ prefix: `${commune_id}/`, cursor });
    for (const objet of page.objects) {
      octets += objet.size;
      nb_fichiers += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { octets, nb_fichiers };
}

// GET /communes — liste des communes clientes avec quelques indicateurs de suivi.
// La commune "nationale" (niveau_national=true) n'est pas une cliente : on l'exclut.
app.get('/communes', async (c) => {
  const communes = await supabaseSelect(c.env, 'communes', {
    select: 'id,slug,nom,population,logo_url,contact_email,forfait,quota_go,statut_client,created_at',
    niveau_national: 'eq.false',
    order: 'nom.asc',
  });

  // Deux lectures légères agrégées côté Worker plutôt qu'une requête par commune (N+1).
  const users = await supabaseSelect(c.env, 'users', { select: 'commune_id' });
  const avis = await supabaseSelect(c.env, 'avis_application', { select: 'commune_id,note' });

  const nbCitoyens = new Map<string, number>();
  for (const u of users) nbCitoyens.set(u.commune_id, (nbCitoyens.get(u.commune_id) ?? 0) + 1);

  const cumulAvis = new Map<string, { total: number; n: number }>();
  for (const a of avis) {
    const e = cumulAvis.get(a.commune_id) ?? { total: 0, n: 0 };
    e.total += a.note; e.n += 1;
    cumulAvis.set(a.commune_id, e);
  }

  const liste = communes.map((commune: any) => {
    const av = cumulAvis.get(commune.id);
    return {
      ...commune,
      nb_citoyens: nbCitoyens.get(commune.id) ?? 0,
      note_moyenne: av ? Math.round((av.total / av.n) * 10) / 10 : null,
      nb_avis: av ? av.n : 0,
    };
  });

  return c.json({ communes: liste });
});

// GET /communes/:id — fiche détaillée d'une commune cliente.
app.get('/communes/:id', async (c) => {
  const id = c.req.param('id');

  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'id,slug,nom,population,logo_url,contact_email,telephone_mairie,email_mairie,lat,lng,forfait,quota_go,statut_client,created_at',
    id: `eq.${id}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  const [membres, avis, stockage] = await Promise.all([
    supabaseSelect(c.env, 'users', { select: 'role', commune_id: `eq.${id}` }),
    supabaseSelect(c.env, 'avis_application', {
      select: 'note,commentaire,created_at', commune_id: `eq.${id}`, order: 'created_at.desc',
    }),
    calculerStockageR2(c.env, id),
  ]);

  const parRole: Record<string, number> = {};
  for (const m of membres) parRole[m.role] = (parRole[m.role] ?? 0) + 1;

  const note_moyenne = avis.length
    ? Math.round((avis.reduce((s: number, a: any) => s + a.note, 0) / avis.length) * 10) / 10
    : null;

  return c.json({
    commune,
    citoyens: { total: membres.length, par_role: parRole },
    avis: { note_moyenne, nb: avis.length, liste: avis },
    stockage,
  });
});

// PATCH /communes/:id/forfait — définit le forfait (nom libre) et le quota de stockage (Go).
// Chaîne/valeur vide → efface le champ (null).
const forfaitSchema = z.object({
  forfait: z.string().max(60).optional().nullable(),
  quota_go: z.number().min(0).max(10000).optional().nullable(),
});

app.patch('/communes/:id/forfait', async (c) => {
  const id = c.req.param('id');
  const body = forfaitSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const patch: Record<string, unknown> = {};
  if (body.data.forfait !== undefined) patch.forfait = body.data.forfait?.trim() || null;
  if (body.data.quota_go !== undefined) patch.quota_go = body.data.quota_go ?? null;
  if (Object.keys(patch).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  await supabaseUpdate(c.env, 'communes', patch, { id: `eq.${id}` });
  return c.json({ ok: true, ...patch });
});

// POST /communes/:id/coordonnees — (re)renseigne lat/lng d'une commune depuis geo.api.gouv.fr.
// La table communes ne stocke pas le code INSEE : on le retrouve via le prospect lié (fiable),
// avec repli sur une recherche par nom. Utile pour les communes créées avant l'auto-remplissage
// des coordonnées à l'onboarding (sinon la météo retombe sur une position par défaut erronée).
app.post('/communes/:id/coordonnees', async (c) => {
  const id = c.req.param('id');
  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'id,nom', id: `eq.${id}` });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  let centre: any = null;
  const [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'code_insee', commune_id: `eq.${id}` });
  if (prospect?.code_insee) {
    const res = await fetch(`https://geo.api.gouv.fr/communes/${prospect.code_insee}?fields=centre&format=json`);
    if (res.ok) centre = ((await res.json()) as any)?.centre;
  }
  if (!centre) {
    // Repli : recherche par nom, on prend la commune la plus peuplée qui correspond.
    const res = await fetch(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(commune.nom)}&fields=centre&boost=population&limit=1`);
    if (res.ok) centre = ((await res.json()) as any)?.[0]?.centre;
  }

  const coords = centre?.coordinates; // [lng, lat]
  if (!Array.isArray(coords) || coords.length !== 2) {
    return c.json({ erreur: 'Coordonnées introuvables pour cette commune.' }, 404);
  }
  const [lng, lat] = coords;
  await supabaseUpdate(c.env, 'communes', { lat, lng }, { id: `eq.${id}` });
  return c.json({ ok: true, lat, lng });
});

// POST /communes/:id/renvoyer-acces — régénère un mot de passe temporaire pour le maire de la
// commune et lui renvoie l'email de bienvenue avec ses identifiants. Utile si le maire a perdu
// ses accès initiaux (le mot de passe d'origine n'est jamais stocké en clair, on en régénère un).
app.post('/communes/:id/renvoyer-acces', async (c) => {
  const id = c.req.param('id');
  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'id,nom,slug', id: `eq.${id}` });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  const [maire] = await supabaseSelect(c.env, 'users', {
    select: 'id,email', commune_id: `eq.${id}`, role: 'eq.maire', order: 'created_at.asc',
  });
  if (!maire) return c.json({ erreur: 'Aucun compte maire sur cette commune.' }, 404);

  const motDePasse = genererMotDePasseTemporaire();
  await supabaseUpdate(c.env, 'users', { password_hash: await hasherMotDePasse(motDePasse) }, { id: `eq.${maire.id}` });

  await envoyerEmailBienvenue(c.env, {
    nomCommune: commune.nom, slug: commune.slug, maireEmail: maire.email, motDePasse,
    frontendUrl: c.env.FRONTEND_URL,
  });
  return c.json({ ok: true, email: maire.email });
});

// POST /email-test — diagnostic d'envoi. Appelle Resend EN DIRECT (pas via envoyerEmail, qui
// échoue silencieusement) pour remonter la vraie cause d'un échec : clé absente, domaine non
// vérifié, etc. Envoie à l'adresse fournie, ou par défaut à l'email du staff connecté.
app.post('/email-test', async (c) => {
  const staff_id = c.get('staff_id');
  const body: any = await c.req.json().catch(() => ({}));
  let destinataire = (body?.destinataire || '').trim();
  if (!destinataire) {
    const [staff] = await supabaseSelect(c.env, 'staff_backoffice', { select: 'email', id: `eq.${staff_id}` });
    destinataire = staff?.email || '';
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinataire)) return c.json({ erreur: 'Adresse email invalide.' }, 400);

  if (!c.env.RESEND_API_KEY) {
    return c.json({ erreur: 'RESEND_API_KEY absente : la clé n\'est pas configurée côté Worker (Cloudflare).' }, 400);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: c.env.EMAIL_FROM || 'Agora <onboarding@resend.dev>',
      to: destinataire,
      subject: 'Test d\'envoi — Backoffice Agora',
      html: '<p>Cet email confirme que l\'envoi d\'emails via Resend fonctionne. 🎉</p><p>— Backoffice Agora</p>',
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return c.json({ erreur: `Resend a refusé l'envoi (${res.status}) : ${data?.message || data?.name || 'erreur inconnue'}` }, 502);
  }
  return c.json({ ok: true, destinataire, from: c.env.EMAIL_FROM || 'onboarding@resend.dev' });
});

// PATCH /communes/:id/statut — statut du cycle de vie client (active | suspendue | resiliee).
app.patch('/communes/:id/statut', async (c) => {
  const id = c.req.param('id');
  const body = z.object({ statut_client: z.enum(STATUTS_CLIENT) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Statut invalide' }, 400);
  await supabaseUpdate(c.env, 'communes', { statut_client: body.data.statut_client }, { id: `eq.${id}` });
  return c.json({ ok: true, statut_client: body.data.statut_client });
});

// POST /communes/:id/envoyer-presentation — envoie l'email de présentation (modèle enregistré)
// à la commune, à tout moment. Destinataire : email de contact, sinon email mairie.
app.post('/communes/:id/envoyer-presentation', async (c) => {
  const id = c.req.param('id');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'nom,slug,contact_email,email_mairie', id: `eq.${id}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  const destinataire = commune.contact_email || commune.email_mairie;
  if (!destinataire) return c.json({ erreur: 'Aucun email de contact pour cette commune (renseigne un contact ou un email mairie).' }, 422);

  await envoyerPresentation(c.env, destinataire, contextePresentation(c.env.FRONTEND_URL, commune.nom, commune.slug));
  return c.json({ ok: true, email: destinataire });
});

// GET /modele-email — modèle d'email de présentation (enregistré, ou défaut de secours).
app.get('/modele-email', async (c) => {
  const modele = await chargerModelePresentation(c.env);
  return c.json({ modele });
});

// PUT /modele-email — enregistre/écrase le modèle (upsert manuel sur cle='presentation').
app.put('/modele-email', async (c) => {
  const body = z.object({
    objet: z.string().min(1).max(200),
    corps_html: z.string().min(1).max(20000),
  }).safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const donnees = { objet: body.data.objet, corps_html: body.data.corps_html, updated_at: new Date().toISOString() };
  const [existant] = await supabaseSelect(c.env, 'modeles_email', { select: 'cle', cle: 'eq.presentation' });
  if (existant) await supabaseUpdate(c.env, 'modeles_email', donnees, { cle: 'eq.presentation' });
  else await supabaseInsert(c.env, 'modeles_email', { cle: 'presentation', ...donnees });
  return c.json({ ok: true });
});

// POST /signature — upload de la photo de signature (R2), stockée dans le modèle. Le corps de
// la requête est l'image brute (image/jpeg ou image/png).
app.post('/signature', async (c) => {
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png)$/.test(contentType)) {
    return c.json({ erreur: 'Format non autorisé (JPEG ou PNG uniquement)' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 2 * 1024 * 1024) return c.json({ erreur: 'Image trop lourde (max 2 Mo)' }, 400);

  // Supprime l'ancienne photo si présente (évite l'accumulation dans R2).
  const [modele] = await supabaseSelect(c.env, 'modeles_email', { select: 'signature_image_url', cle: 'eq.presentation' });
  if (modele?.signature_image_url && c.env.R2_PUBLIC_BASE) {
    const ancienneCle = modele.signature_image_url.replace(`${c.env.R2_PUBLIC_BASE}/`, '');
    if (ancienneCle && ancienneCle !== modele.signature_image_url) await deleteObject(c.env, ancienneCle);
  }

  const extension = contentType.split('/')[1];
  const cle = `backoffice/signature-${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, cle, donnees, contentType);

  // Upsert : crée le modèle avec les valeurs par défaut s'il n'existe pas encore.
  const patch = { signature_image_url: url, updated_at: new Date().toISOString() };
  if (modele) await supabaseUpdate(c.env, 'modeles_email', patch, { cle: 'eq.presentation' });
  else await supabaseInsert(c.env, 'modeles_email', { cle: 'presentation', ...MODELE_PRESENTATION_DEFAUT, ...patch });

  return c.json({ ok: true, url });
});

// GET /apercu — indicateurs globaux pour la page d'accueil du backoffice.
app.get('/apercu', async (c) => {
  const communes = await supabaseSelect(c.env, 'communes', {
    select: 'id', niveau_national: 'eq.false',
  });
  const users = await supabaseSelect(c.env, 'users', { select: 'id' });
  const avis = await supabaseSelect(c.env, 'avis_application', { select: 'note' });

  const note_moyenne = avis.length
    ? Math.round((avis.reduce((s: number, a: any) => s + a.note, 0) / avis.length) * 10) / 10
    : null;

  return c.json({
    nb_communes: communes.length,
    nb_citoyens: users.length,
    note_moyenne,
    nb_avis: avis.length,
  });
});

export default app;

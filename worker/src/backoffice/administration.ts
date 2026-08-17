// worker/src/backoffice/administration.ts
// Administration/suivi des communes clientes (Phase 1 du backoffice). Toutes les routes sont
// derrière backofficeMiddleware : accès staff transverse, pas de commune_id dans le jeton.
// On lit directement les tables existantes (communes, users, avis_application) et on calcule
// le stockage R2 réellement consommé par commune via le préfixe de clé `${commune_id}/`.
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseUpdate, supabaseInsert, supabaseDelete, supabaseCount } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { hasherMotDePasse } from '../lib/password';
import {
  envoyerEmailBienvenue, genererMotDePasseTemporaire,
  envoyerPresentation, contextePresentation, chargerModelePresentation,
  MODELE_PRESENTATION_DEFAUT,
} from './email-commune';
import { uploaderFichier, deleteObject } from '../storage';

const STATUTS_CLIENT = ['active', 'suspendue', 'resiliee'] as const;

// Doit rester synchronisé avec ONGLETS_VALIDES dans worker/src/routes/moderation.ts (moins
// 'profil', qui n'est pas un module désactivable — c'est le compte du citoyen lui-même).
const TOUS_LES_ONGLETS = [
  'actualites', 'alertes', 'thermometre', 'mur', 'agenda', 'coups_de_main', 'chasse_tresor',
  'conseil', 'annuaire', 'bulletin', 'photo_du_jour', 'enigmes', 'lois', 'memoire',
] as const;
// Palier gratuit : périmètre pilotable depuis le backoffice, stocké en base (table
// onglets_gratuits, migration 036) au lieu d'être figé ici — voir chargerOngletsGratuits et
// PUT /onglets-gratuits plus bas. Un changement de ce périmètre est GLOBAL et RÉTROACTIF :
// il s'applique immédiatement à toutes les communes actuellement sur forfait = 'Gratuit'.
export async function chargerOngletsGratuits(env: any): Promise<string[]> {
  const rows = await supabaseSelect(env, 'onglets_gratuits', { select: 'cle' });
  return rows.map((r: any) => r.cle);
}

// Upsert manuel des 14 onglets pour une commune donnée, à partir de la liste des clés à
// activer. onglets_config a UNIQUE(commune_id, cle) mais notre client REST ne fait pas
// d'upsert natif : on complète ce qui existe déjà et on insère le reste. Exportée : réutilisée
// par prospection.ts pour l'activation automatique d'une commune gratuite (voir prospecterUn).
// Cas fréquent (commune neuve, aucune ligne existante) traité en UN SEUL insert group plutôt
// que 14 requêtes individuelles — un lot d'activations en masse (prospecterUn en boucle)
// pouvait sinon accumuler des centaines de sous-requêtes en une seule invocation Worker.
export async function appliquerOngletsSurCommune(env: any, communeId: string, ongletsActifs: string[]): Promise<void> {
  const existants = await supabaseSelect(env, 'onglets_config', { select: 'cle', commune_id: `eq.${communeId}` });
  const clesExistantes = new Set(existants.map((o: any) => o.cle));

  if (clesExistantes.size === 0) {
    await supabaseInsert(env, 'onglets_config', TOUS_LES_ONGLETS.map((cle) => ({
      commune_id: communeId, cle, actif: ongletsActifs.includes(cle),
    })));
    return;
  }

  for (const cle of TOUS_LES_ONGLETS) {
    const actif = ongletsActifs.includes(cle);
    if (clesExistantes.has(cle)) {
      await supabaseUpdate(env, 'onglets_config', { actif }, { commune_id: `eq.${communeId}`, cle: `eq.${cle}` });
    } else {
      await supabaseInsert(env, 'onglets_config', { commune_id: communeId, cle, actif });
    }
  }
}

// Rôles gérables depuis le backoffice. 'superadmin' n'y figure JAMAIS — règle absolue du
// projet : ce rôle ne s'attribue qu'en base directement, jamais via une interface.
const ROLES_GERABLES = ['citoyen', 'admin', 'elu', 'maire'] as const;

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
    select: 'id,slug,nom,population,logo_url,contact_email,forfait,quota_go,statut_client,prochaine_echeance,email_invalide,created_at',
    niveau_national: 'not.is.true', // exclut seulement la commune nationale (garde false ET null)
    order: 'nom.asc',
    limit: '5000',
  });

  // Deux lectures agrégées côté Worker plutôt qu'une requête par commune (N+1). Limite haute
  // explicite : sans elle, PostgREST plafonne à ~1000 lignes et fausse les comptages.
  const users = await supabaseSelect(c.env, 'users', { select: 'commune_id', limit: '100000' });
  const avis = await supabaseSelect(c.env, 'avis_application', { select: 'commune_id,note', limit: '100000' });

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
    select: 'id,slug,nom,population,logo_url,contact_email,telephone_mairie,email_mairie,lat,lng,forfait,quota_go,statut_client,prix_annuel_ttc,duree_engagement_mois,prochaine_echeance,created_at',
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

// POST /email-test-presentation — envoie un email de test avec le VRAI modèle de présentation
// (variante active), pour vérifier le rendu ET le suivi (ouverture/clic, voir migrations 040/041)
// sans créer de commune ni toucher un prospect réel. Marqué est_test=true : exclu de l'entonnoir
// par variante (GET /prospection/stats-variantes).
app.post('/email-test-presentation', async (c) => {
  const staff_id = c.get('staff_id');
  const body: any = await c.req.json().catch(() => ({}));
  let destinataire = (body?.destinataire || '').trim();
  if (!destinataire) {
    const [staff] = await supabaseSelect(c.env, 'staff_backoffice', { select: 'email', id: `eq.${staff_id}` });
    destinataire = staff?.email || '';
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinataire)) return c.json({ erreur: 'Adresse email invalide.' }, 400);

  const ctx = contextePresentation(c.env.FRONTEND_URL, 'Votre Commune (aperçu de test)', 'decouverte-gratuite');
  const { variante, resendEmailId } = await envoyerPresentation(c.env, destinataire, ctx, {
    maireEmail: destinataire, motDePasse: '(exemple — ceci est un test, pas un vrai compte)',
  });

  if (resendEmailId) {
    await supabaseInsert(c.env, 'envois_prospection', {
      prospect_id: null, resend_email_id: resendEmailId, email: destinataire, variante, est_test: true,
    });
  }
  return c.json({ ok: true, destinataire, variante });
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

// GET /modele-email — variante ACTIVE de l'email de présentation (enregistrée, ou défaut de
// secours). Conservé pour l'aperçu / l'envoi de test, qui n'ont besoin que du modèle courant.
app.get('/modele-email', async (c) => {
  const modele = await chargerModelePresentation(c.env);
  return c.json({ modele });
});

// — Variantes de l'email de présentation (A/B testing, voir migration 037) — une seule
//   actif=true à la fois par cle='presentation' ; c'est elle qui part dans tous les envois.

// GET /modeles-presentation — liste toutes les variantes (sans le corps HTML, pour un
// sélecteur léger côté backoffice). Si aucune n'a jamais été enregistrée, on amorce avec le
// défaut de secours (celui réellement utilisé pour l'envoi tant qu'aucune ligne n'existe, voir
// chargerModelePresentation) : sans ça, l'éditeur apparaît vide alors que ce texte part déjà
// dans les emails.
app.get('/modeles-presentation', async (c) => {
  let variantes = await supabaseSelect(c.env, 'modeles_email', {
    select: 'id,nom,actif,objet,updated_at', cle: 'eq.presentation', order: 'created_at.asc',
  });
  if (!variantes.length) {
    const [creee] = await supabaseInsert(c.env, 'modeles_email', {
      cle: 'presentation', nom: 'Variante A', actif: true,
      objet: MODELE_PRESENTATION_DEFAUT.objet, corps_html: MODELE_PRESENTATION_DEFAUT.corps_html,
    });
    if (creee) variantes = [creee];
  }
  return c.json({ variantes });
});

// GET /modeles-presentation/:id — contenu complet d'une variante, pour la charger dans l'éditeur.
app.get('/modeles-presentation/:id', async (c) => {
  const [variante] = await supabaseSelect(c.env, 'modeles_email', {
    select: 'id,nom,actif,objet,corps_html,signature_image_url,logo_image_url',
    cle: 'eq.presentation', id: `eq.${c.req.param('id')}`,
  });
  if (!variante) return c.json({ erreur: 'Variante introuvable' }, 404);
  return c.json({ variante });
});

const varianteSchema = z.object({
  nom: z.string().min(1).max(80),
  objet: z.string().min(1).max(200),
  corps_html: z.string().min(1).max(20000),
});

// POST /modeles-presentation — crée une nouvelle variante (inactive par défaut : on ne bascule
// jamais l'envoi automatiquement, l'activation est un choix explicite). Reprend la photo/logo
// de la variante active courante, partagés entre toutes les variantes.
app.post('/modeles-presentation', async (c) => {
  const body = varianteSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [active] = await supabaseSelect(c.env, 'modeles_email', {
    select: 'signature_image_url,logo_image_url', cle: 'eq.presentation', actif: 'eq.true',
  });
  const [variante] = await supabaseInsert(c.env, 'modeles_email', {
    cle: 'presentation', actif: false, ...body.data,
    signature_image_url: active?.signature_image_url ?? null,
    logo_image_url: active?.logo_image_url ?? null,
  });
  return c.json({ ok: true, variante });
});

// PUT /modeles-presentation/:id — modifie le contenu d'une variante (ne touche pas actif).
app.put('/modeles-presentation/:id', async (c) => {
  const body = varianteSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const donnees = { ...body.data, updated_at: new Date().toISOString() };
  const maj = await supabaseUpdate(c.env, 'modeles_email', donnees, {
    id: `eq.${c.req.param('id')}`, cle: 'eq.presentation',
  });
  if (!maj.length) return c.json({ erreur: 'Variante introuvable' }, 404);
  return c.json({ ok: true });
});

// POST /modeles-presentation/:id/activer — bascule la variante active. Désactive d'abord toutes
// les autres (l'index unique idx_modeles_email_cle_actif interdit deux actives à la fois pour
// le même cle), puis active la cible.
app.post('/modeles-presentation/:id/activer', async (c) => {
  const id = c.req.param('id');
  const [cible] = await supabaseSelect(c.env, 'modeles_email', {
    select: 'id,nom', cle: 'eq.presentation', id: `eq.${id}`,
  });
  if (!cible) return c.json({ erreur: 'Variante introuvable' }, 404);

  await supabaseUpdate(c.env, 'modeles_email', { actif: false }, { cle: 'eq.presentation', actif: 'eq.true' });
  await supabaseUpdate(c.env, 'modeles_email', { actif: true }, { id: `eq.${id}` });
  return c.json({ ok: true, nom: cible.nom });
});

// DELETE /modeles-presentation/:id — refuse de supprimer la variante active (bascule-en une
// autre d'abord) ou la dernière restante (il en faut toujours au moins une).
app.delete('/modeles-presentation/:id', async (c) => {
  const id = c.req.param('id');
  const toutes = await supabaseSelect(c.env, 'modeles_email', { select: 'id,actif', cle: 'eq.presentation' });
  const cible = toutes.find((v: any) => v.id === id);
  if (!cible) return c.json({ erreur: 'Variante introuvable' }, 404);
  if (cible.actif) return c.json({ erreur: 'Impossible de supprimer la variante active : bascule sur une autre d\'abord.' }, 400);
  if (toutes.length <= 1) return c.json({ erreur: 'Il doit toujours rester au moins une variante.' }, 400);

  await supabaseDelete(c.env, 'modeles_email', { id: `eq.${id}` });
  return c.json({ ok: true });
});

// Upload d'une image du modèle d'email (signature ou logo) dans R2. Partagée entre TOUTES les
// variantes de cle='presentation' (même photo partout, seul le texte se teste en A/B) : le
// update ci-dessous filtre uniquement sur cle, donc touche toutes les lignes d'un coup.
async function uploaderImageModele(c: any, colonne: 'signature_image_url' | 'logo_image_url', prefixe: string) {
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png)$/.test(contentType)) {
    return c.json({ erreur: 'Format non autorisé (JPEG ou PNG uniquement)' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 2 * 1024 * 1024) return c.json({ erreur: 'Image trop lourde (max 2 Mo)' }, 400);

  // Supprime l'ancienne image si présente (évite l'accumulation dans R2).
  const [modele] = await supabaseSelect(c.env, 'modeles_email', { select: colonne, cle: 'eq.presentation', limit: '1' });
  const ancienneUrl = modele?.[colonne];
  if (ancienneUrl && c.env.R2_PUBLIC_BASE) {
    const ancienneCle = ancienneUrl.replace(`${c.env.R2_PUBLIC_BASE}/`, '');
    if (ancienneCle && ancienneCle !== ancienneUrl) await deleteObject(c.env, ancienneCle);
  }

  const extension = contentType.split('/')[1];
  const cle = `backoffice/${prefixe}-${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, cle, donnees, contentType);

  // Upsert : crée la première variante avec les valeurs par défaut si aucune n'existe encore.
  const patch = { [colonne]: url, updated_at: new Date().toISOString() };
  if (modele) await supabaseUpdate(c.env, 'modeles_email', patch, { cle: 'eq.presentation' });
  else await supabaseInsert(c.env, 'modeles_email', { cle: 'presentation', nom: 'Variante A', actif: true, ...MODELE_PRESENTATION_DEFAUT, ...patch });

  return c.json({ ok: true, url });
}

// POST /signature — photo de signature ; POST /logo-email — logo d'en-tête. Image brute en corps.
app.post('/signature', (c) => uploaderImageModele(c, 'signature_image_url', 'signature'));
app.post('/logo-email', (c) => uploaderImageModele(c, 'logo_image_url', 'logo'));

// PUT /modele-fiche — contenu HTML de la fiche de présentation (upsert sur cle='fiche').
app.put('/modele-fiche', async (c) => {
  const body = z.object({ contenu_html: z.string().min(1).max(40000) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const donnees = { objet: 'Fiche de présentation', corps_html: body.data.contenu_html, updated_at: new Date().toISOString() };
  const [existant] = await supabaseSelect(c.env, 'modeles_email', { select: 'cle', cle: 'eq.fiche' });
  if (existant) await supabaseUpdate(c.env, 'modeles_email', donnees, { cle: 'eq.fiche' });
  else await supabaseInsert(c.env, 'modeles_email', { cle: 'fiche', nom: 'Défaut', ...donnees });
  return c.json({ ok: true });
});

// GET /emails-rejetes — bounces/plaintes captés via le webhook Resend (les plus récents).
app.get('/emails-rejetes', async (c) => {
  const emails = await supabaseSelect(c.env, 'emails_rejetes', {
    select: 'email,commune_nom,type,raison,created_at', order: 'created_at.desc', limit: '200',
  });
  return c.json({ emails });
});

// GET /communes/:id/frequentation — même logique que /moderation/stats-connexions côté citoyen,
// mais pour une commune donnée (pas de commune_id dans le JWT staff). Actifs jour/7j/30j (via
// users.derniere_connexion_streak), % population, et série des connexions par jour (30 jours).
app.get('/communes/:id/frequentation', async (c) => {
  const id = c.req.param('id');
  const jourISO = (decalage: number) => {
    const d = new Date();
    d.setDate(d.getDate() - decalage);
    return d.toISOString().slice(0, 10);
  };
  const aujourdhui = jourISO(0);
  const il7 = jourISO(6);
  const il30 = jourISO(29);

  const [commune, users, connexions] = await Promise.all([
    supabaseSelect(c.env, 'communes', { select: 'population', id: `eq.${id}` }),
    supabaseSelect(c.env, 'users', { select: 'derniere_connexion_streak', commune_id: `eq.${id}` }),
    supabaseSelect(c.env, 'connexions_journalieres', {
      select: 'jour', commune_id: `eq.${id}`, jour: `gte.${il30}`, limit: '5000',
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

// GET /communes/:id/historique-prospection — retrace le parcours commercial : le prospect qui a
// donné naissance à cette commune (prospects.commune_id -> communes.id, posé à l'activation ou
// à la conversion manuelle) et sa timeline d'échanges (prospect_interactions), autrement
// invisible une fois la conversion faite. Lecture seule ; l'ajout d'échanges reste sur la fiche
// prospect tant qu'il en existe une.
app.get('/communes/:id/historique-prospection', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,statut', commune_id: `eq.${id}`,
  });
  if (!prospect) return c.json({ prospect: null, interactions: [] });

  const interactions = await supabaseSelect(c.env, 'prospect_interactions', {
    select: 'type,contenu,created_at', prospect_id: `eq.${prospect.id}`, order: 'created_at.desc',
  });
  return c.json({ prospect, interactions });
});

// GET /communes/:id/doublons — comptes partageant le même nom + prénom (normalisés), groupes
// de 2+. Purement INDICATIF (homonymes possibles, pas une preuve de multi-compte) et en lecture
// seule. Exclut les comptes anonymisés (RGPD).
app.get('/communes/:id/doublons', async (c) => {
  const id = c.req.param('id');
  const users = await supabaseSelect(c.env, 'users', {
    select: 'nom,prenom,email,role,created_at,compte_supprime_le', commune_id: `eq.${id}`,
  });

  const normaliser = (s: string) =>
    (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');

  const groupes: Record<string, { nom: string; prenom: string; comptes: any[] }> = {};
  for (const u of users) {
    if (u.compte_supprime_le) continue; // comptes anonymisés exclus
    const cle = `${normaliser(u.prenom)}|${normaliser(u.nom)}`;
    if (!cle.replace('|', '').trim()) continue;
    (groupes[cle] ??= { nom: u.nom, prenom: u.prenom, comptes: [] }).comptes.push({
      email: u.email, role: u.role, created_at: u.created_at,
    });
  }

  const doublons = Object.values(groupes)
    .filter((g) => g.comptes.length >= 2)
    .sort((a, b) => b.comptes.length - a.comptes.length);
  return c.json({ doublons });
});

// GET /communes/:id/rgpd — stats de suivi RGPD : combien de citoyens exportent leurs données
// (droit à la portabilité, journalisé depuis GET /auth/mes-donnees) et combien suppriment leur
// compte (déjà journalisé via users.compte_supprime_le, aucune table dédiée nécessaire).
app.get('/communes/:id/rgpd', async (c) => {
  const id = c.req.param('id');
  const [exports, tousUsers] = await Promise.all([
    supabaseSelect(c.env, 'exports_rgpd_donnees', {
      select: 'user_id,created_at', commune_id: `eq.${id}`, order: 'created_at.desc', limit: '500',
    }),
    supabaseSelect(c.env, 'users', {
      select: 'id,nom,prenom,email,compte_supprime_le,created_at', commune_id: `eq.${id}`, limit: '20000',
    }),
  ]);

  const parUser = new Map(tousUsers.map((u: any) => [u.id, u]));
  const suppressions = tousUsers
    .filter((u: any) => u.compte_supprime_le)
    .sort((a: any, b: any) => (a.compte_supprime_le < b.compte_supprime_le ? 1 : -1));

  const detailExports = exports.slice(0, 50).map((e: any) => {
    const u = parUser.get(e.user_id);
    return {
      created_at: e.created_at,
      nom: !u ? 'Compte introuvable' : u.compte_supprime_le ? 'Compte supprimé' : `${u.prenom} ${u.nom}`,
      email: u && !u.compte_supprime_le ? u.email : null,
    };
  });

  return c.json({
    nb_citoyens: tousUsers.length,
    nb_exports: exports.length,
    nb_suppressions: suppressions.length,
    exports: detailExports,
    suppressions: suppressions.slice(0, 50).map((u: any) => ({
      compte_supprime_le: u.compte_supprime_le, inscrit_le: u.created_at,
    })),
  });
});

// GET /communes/:id/utilisateurs — liste paginée (100/page) des citoyens d'une commune.
// Recherche nom/prénom/email, filtre par rôle. Les comptes déjà anonymisés (RGPD) sont exclus.
const TAILLE_PAGE_UTILISATEURS = 100;

app.get('/communes/:id/utilisateurs', async (c) => {
  const id = c.req.param('id');
  const where: Record<string, string> = { commune_id: `eq.${id}`, compte_supprime_le: 'is.null' };

  const role = c.req.query('role');
  if (role && (ROLES_GERABLES as readonly string[]).includes(role)) where.role = `eq.${role}`;
  const recherche = c.req.query('recherche');
  if (recherche) where.or = `(nom.ilike.*${recherche}*,prenom.ilike.*${recherche}*,email.ilike.*${recherche}*)`;

  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const offset = (page - 1) * TAILLE_PAGE_UTILISATEURS;

  const [utilisateurs, total] = await Promise.all([
    supabaseSelect(c.env, 'users', {
      ...where,
      select: 'id,nom,prenom,email,role,xp,niveau,created_at,derniere_connexion_streak',
      order: 'created_at.desc',
      limit: String(TAILLE_PAGE_UTILISATEURS),
      offset: String(offset),
    }),
    supabaseCount(c.env, 'users', where),
  ]);

  return c.json({ utilisateurs, page, taille: TAILLE_PAGE_UTILISATEURS, total });
});

// POST /communes/:id/utilisateurs — création manuelle d'un compte (mot de passe temporaire
// saisi par le staff, comme à l'onboarding du maire). Rôle limité à ROLES_GERABLES.
const creerUtilisateurSchema = z.object({
  nom: z.string().min(1).max(100),
  prenom: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(ROLES_GERABLES),
  password: z.string().min(6).max(200),
});

app.post('/communes/:id/utilisateurs', async (c) => {
  const id = c.req.param('id');
  const body = creerUtilisateurSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [existant] = await supabaseSelect(c.env, 'users', {
    select: 'id', commune_id: `eq.${id}`, email: `eq.${data.email}`,
  });
  if (existant) return c.json({ erreur: 'Un compte existe déjà avec cet email dans cette commune.' }, 409);

  const password_hash = await hasherMotDePasse(data.password);
  const [utilisateur] = await supabaseInsert(c.env, 'users', {
    commune_id: id, nom: data.nom, prenom: data.prenom, email: data.email, role: data.role,
    password_hash, consentement_rgpd_le: new Date().toISOString(),
  });
  return c.json({ ok: true, utilisateur }, 201);
});

// PATCH /communes/:id/utilisateurs/:userId — modifie identité/rôle. Jamais 'superadmin'
// (le schéma Zod l'exclut structurellement, cf. ROLES_GERABLES).
const modifierUtilisateurSchema = z.object({
  nom: z.string().min(1).max(100).optional(),
  prenom: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES_GERABLES).optional(),
});

app.patch('/communes/:id/utilisateurs/:userId', async (c) => {
  const id = c.req.param('id');
  const userId = c.req.param('userId');
  const body = modifierUtilisateurSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  if (body.data.email) {
    const [existant] = await supabaseSelect(c.env, 'users', {
      select: 'id', commune_id: `eq.${id}`, email: `eq.${body.data.email}`,
    });
    if (existant && existant.id !== userId) return c.json({ erreur: 'Cet email est déjà utilisé par un autre compte de cette commune.' }, 409);
  }

  await supabaseUpdate(c.env, 'users', body.data, { id: `eq.${userId}`, commune_id: `eq.${id}` });
  return c.json({ ok: true });
});

// POST /communes/:id/utilisateurs/:userId/reinitialiser-mdp — régénère un mot de passe
// temporaire, renvoyé UNE FOIS en clair pour que le staff le communique (pas d'email auto,
// pour ne pas surprendre un citoyen qui n'a rien demandé).
app.post('/communes/:id/utilisateurs/:userId/reinitialiser-mdp', async (c) => {
  const id = c.req.param('id');
  const userId = c.req.param('userId');
  const [u] = await supabaseSelect(c.env, 'users', { select: 'id,email', id: `eq.${userId}`, commune_id: `eq.${id}` });
  if (!u) return c.json({ erreur: 'Compte introuvable' }, 404);

  const motDePasse = genererMotDePasseTemporaire();
  await supabaseUpdate(c.env, 'users', { password_hash: await hasherMotDePasse(motDePasse) }, { id: `eq.${userId}` });
  return c.json({ ok: true, email: u.email, mot_de_passe: motDePasse });
});

// DELETE /communes/:id/utilisateurs/:userId — anonymisation RGPD (même mécanisme que
// DELETE /auth/moi, en libre-service côté citoyen) : jamais de suppression physique de la
// ligne, pour ne pas casser le contenu communautaire déjà publié par la personne.
app.delete('/communes/:id/utilisateurs/:userId', async (c) => {
  const id = c.req.param('id');
  const userId = c.req.param('userId');
  const [u] = await supabaseSelect(c.env, 'users', { select: 'id,role', id: `eq.${userId}`, commune_id: `eq.${id}` });
  if (!u) return c.json({ erreur: 'Compte introuvable' }, 404);
  if (u.role === 'superadmin') return c.json({ erreur: 'Action non autorisée sur un compte superadmin.' }, 403);

  await supabaseDelete(c.env, 'push_subscriptions', { user_id: `eq.${userId}` });
  await supabaseDelete(c.env, 'refresh_tokens', { user_id: `eq.${userId}` });
  await supabaseDelete(c.env, 'annuaire', { user_id: `eq.${userId}`, commune_id: `eq.${id}` });
  await supabaseUpdate(c.env, 'event_attendees', { contact_telephone: null, contact_email: null }, {
    user_id: `eq.${userId}`, commune_id: `eq.${id}`,
  });
  await supabaseUpdate(c.env, 'users', {
    email: `supprime-${userId}@anonyme.local`,
    password_hash: crypto.randomUUID(),
    nom: 'Compte',
    prenom: 'supprimé',
    compte_supprime_le: new Date().toISOString(),
  }, { id: `eq.${userId}`, commune_id: `eq.${id}` });

  return c.json({ ok: true });
});

// GET /grille-tarifaire — les 6 tranches de population + le nombre de mois offerts pour un
// engagement 3 ans. Rien n'est codé en dur : tout est éditable depuis le backoffice.
app.get('/grille-tarifaire', async (c) => {
  const [tranches, parametres] = await Promise.all([
    supabaseSelect(c.env, 'grille_tarifaire', {
      select: 'id,population_min,population_max,prix_annuel_ttc,ordre', order: 'ordre.asc',
    }),
    supabaseSelect(c.env, 'parametres_facturation', { select: 'cle,valeur', cle: 'eq.mois_offerts_3ans' }),
  ]);
  const moisOfferts3ans = parametres[0] ? parseInt(parametres[0].valeur, 10) : 0;
  return c.json({ tranches, mois_offerts_3ans: moisOfferts3ans });
});

// PUT /grille-tarifaire — met à jour les prix des 6 tranches + les mois offerts.
const grilleTarifaireSchema = z.object({
  tranches: z.array(z.object({ id: z.string().uuid(), prix_annuel_ttc: z.number().min(0) })),
  mois_offerts_3ans: z.number().int().min(0).max(36),
});

app.put('/grille-tarifaire', async (c) => {
  const body = grilleTarifaireSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  await Promise.all(body.data.tranches.map((t) =>
    supabaseUpdate(c.env, 'grille_tarifaire', {
      prix_annuel_ttc: t.prix_annuel_ttc, updated_at: new Date().toISOString(),
    }, { id: `eq.${t.id}` }),
  ));
  await supabaseUpdate(c.env, 'parametres_facturation', { valeur: String(body.data.mois_offerts_3ans) }, { cle: 'eq.mois_offerts_3ans' });
  return c.json({ ok: true });
});

// PATCH /communes/:id/abonnement — prix retenu, durée d'engagement (12 ou 36 mois), échéance.
const abonnementSchema = z.object({
  prix_annuel_ttc: z.number().min(0).nullable().optional(),
  duree_engagement_mois: z.union([z.literal(12), z.literal(36)]).optional(),
  prochaine_echeance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

app.patch('/communes/:id/abonnement', async (c) => {
  const id = c.req.param('id');
  const body = abonnementSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  await supabaseUpdate(c.env, 'communes', body.data, { id: `eq.${id}` });
  return c.json({ ok: true });
});

// POST /communes/:id/abonnement/marquer-paye — encaisse l'échéance en cours : avance la
// prochaine échéance de la durée d'engagement, et réarme le rappel automatique pour le
// prochain cycle (derniere_relance_echeance_le remise à zéro).
app.post('/communes/:id/abonnement/marquer-paye', async (c) => {
  const id = c.req.param('id');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'prochaine_echeance,duree_engagement_mois', id: `eq.${id}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  const base = commune.prochaine_echeance ? new Date(commune.prochaine_echeance) : new Date();
  base.setMonth(base.getMonth() + (commune.duree_engagement_mois || 12));
  const nouvelleEcheance = base.toISOString().slice(0, 10);

  await supabaseUpdate(c.env, 'communes', {
    prochaine_echeance: nouvelleEcheance, derniere_relance_echeance_le: null,
  }, { id: `eq.${id}` });
  return c.json({ ok: true, prochaine_echeance: nouvelleEcheance });
});

// GET /echeances — communes dont l'abonnement arrive à échéance dans les 60 jours (ou déjà
// dépassée), pour la vue d'ensemble du backoffice.
app.get('/echeances', async (c) => {
  const dans60Jours = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const communes = await supabaseSelect(c.env, 'communes', {
    select: 'id,nom,slug,prix_annuel_ttc,duree_engagement_mois,prochaine_echeance',
    niveau_national: 'not.is.true',
    prochaine_echeance: `lte.${dans60Jours}`,
    order: 'prochaine_echeance.asc',
  });
  // Factures non soldées, quel que soit leur statut (émise ou déposée sur Chorus Pro) — même
  // logique d'alerte que les échéances d'abonnement ci-dessus, pour une seule vue "ce qui a
  // besoin d'attention" plutôt que deux écrans séparés. nom_destinataire est dénormalisé sur la
  // facture (capturé à sa création), pas besoin de jointure vers communes.
  const factures = await supabaseSelect(c.env, 'factures', {
    select: 'id,numero,commune_id,nom_destinataire,montant_ttc,date_echeance,statut',
    statut: 'neq.payee', order: 'date_echeance.asc', limit: '500',
  });
  return c.json({ communes, factures });
});

// POST /communes/:id/onglets/preset — applique en un clic le palier « gratuit » (périmètre
// courant de la table onglets_gratuits) ou « complet » (tout actif). Met aussi à jour le
// libellé forfait affiché.
const presetSchema = z.object({ preset: z.enum(['gratuit', 'complet']) });

app.post('/communes/:id/onglets/preset', async (c) => {
  const id = c.req.param('id');
  const body = presetSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Préréglage invalide' }, 400);

  const ongletsActifs = body.data.preset === 'complet' ? [...TOUS_LES_ONGLETS] : await chargerOngletsGratuits(c.env);
  await appliquerOngletsSurCommune(c.env, id, ongletsActifs);

  const forfait = body.data.preset === 'complet' ? 'Version complète' : 'Gratuit';
  await supabaseUpdate(c.env, 'communes', { forfait }, { id: `eq.${id}` });
  return c.json({ ok: true, forfait });
});

// GET /communes/:id/onglets — état actif/inactif des 14 modules pour cette commune (complète
// avec actif=true les modules qui n'ont pas encore de ligne, ex. module ajouté après la
// création de la commune — même logique que GET /:slug/moderation/onglets côté citoyen).
app.get('/communes/:id/onglets', async (c) => {
  const id = c.req.param('id');
  const onglets = await supabaseSelect(c.env, 'onglets_config', { select: 'cle,actif', commune_id: `eq.${id}` });
  const clesExistantes = new Set(onglets.map((o: any) => o.cle));
  const completes = [
    ...onglets,
    ...TOUS_LES_ONGLETS.filter((cle) => !clesExistantes.has(cle)).map((cle) => ({ cle, actif: true })),
  ];
  return c.json({ onglets: completes });
});

// PATCH /communes/:id/onglets/:cle — bascule un seul module. Équivalent backoffice de
// PATCH /:slug/moderation/onglets/:cle (réservé au superadmin côté citoyen, donc à un compte
// existant DANS cette commune) : le staff backoffice est déjà l'équivalent superadmin
// transverse, pas besoin de compte superadmin par commune pour ce geste courant.
app.patch('/communes/:id/onglets/:cle', async (c) => {
  const id = c.req.param('id');
  const cle = c.req.param('cle');
  if (!(TOUS_LES_ONGLETS as readonly string[]).includes(cle)) return c.json({ erreur: 'Onglet invalide' }, 400);
  const body = z.object({ actif: z.boolean() }).safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Corps invalide' }, 400);

  const [existant] = await supabaseSelect(c.env, 'onglets_config', { select: 'id', commune_id: `eq.${id}`, cle: `eq.${cle}` });
  if (existant) {
    await supabaseUpdate(c.env, 'onglets_config', { actif: body.data.actif }, { commune_id: `eq.${id}`, cle: `eq.${cle}` });
  } else {
    await supabaseInsert(c.env, 'onglets_config', { commune_id: id, cle, actif: body.data.actif });
  }
  return c.json({ ok: true });
});

// GET /onglets-gratuits — périmètre actuel du palier gratuit + liste complète des modules
// disponibles (pour construire les cases à cocher côté backoffice).
app.get('/onglets-gratuits', async (c) => {
  const onglets = await chargerOngletsGratuits(c.env);
  return c.json({ onglets, tous: TOUS_LES_ONGLETS });
});

// PUT /onglets-gratuits — redéfinit le périmètre du palier gratuit. Changement GLOBAL et
// RÉTROACTIF (décidé avec Léandre le 2026-08-15) : réapplique immédiatement le nouveau
// périmètre à toutes les communes actuellement sur forfait = 'Gratuit', pas seulement aux
// futures. Retourne le nombre de communes mises à jour.
const ongletsGratuitsSchema = z.object({ onglets: z.array(z.enum(TOUS_LES_ONGLETS)) });

app.put('/onglets-gratuits', async (c) => {
  const body = ongletsGratuitsSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Sélection de modules invalide' }, 400);

  const actuels = await supabaseSelect(c.env, 'onglets_gratuits', { select: 'cle' });
  const clesActuelles = new Set(actuels.map((o: any) => o.cle));
  const nouvelles = new Set(body.data.onglets);

  for (const cle of clesActuelles) {
    if (!nouvelles.has(cle)) await supabaseDelete(c.env, 'onglets_gratuits', { cle: `eq.${cle}` });
  }
  for (const cle of nouvelles) {
    if (!clesActuelles.has(cle)) await supabaseInsert(c.env, 'onglets_gratuits', { cle });
  }

  const communesGratuites = await supabaseSelect(c.env, 'communes', { select: 'id', forfait: 'eq.Gratuit', limit: '5000' });
  for (const commune of communesGratuites) {
    await appliquerOngletsSurCommune(c.env, commune.id, body.data.onglets);
  }

  return c.json({ ok: true, onglets: body.data.onglets, nb_communes_mises_a_jour: communesGratuites.length });
});

// GET /apercu — indicateurs globaux pour la page d'accueil du backoffice.
app.get('/apercu', async (c) => {
  const communes = await supabaseSelect(c.env, 'communes', {
    select: 'id', niveau_national: 'not.is.true', limit: '5000',
  });
  const users = await supabaseSelect(c.env, 'users', { select: 'id', limit: '100000' });
  const avis = await supabaseSelect(c.env, 'avis_application', { select: 'note', limit: '100000' });

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

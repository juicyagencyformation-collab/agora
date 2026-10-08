// worker/src/routes/decouverte.ts
// Seule route de toute l'app qui lit délibérément à travers plusieurs communes.
// Exception strictement scopée : uniquement les communes ayant activé partage_regional,
// uniquement les événements officiels (jamais de contenu citoyen), aucune authentification
// requise (page publique, gratuite, ouverte à tous — y compris aux habitants de communes
// qui n'utilisent pas encore Agora).
import { Hono } from 'hono';
import { z } from 'zod';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import { setCookie } from 'hono/cookie';
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';
import { distanceMetres } from '../lib/geo';
import { hasherMotDePasse } from '../lib/password';
import { hasherToken, genererRefreshToken } from '../auth';
import { genererSlugUnique } from '../backoffice/prospection';
import { chargerOngletsGratuits, appliquerOngletsSurCommune } from '../backoffice/administration';
import { emailConfirmationActivationHtml } from '../backoffice/email-commune';
import { envoyerEmail } from '../lib/email';

const DUREE_TOKEN_ACTIVATION_MS = 48 * 3600 * 1000;

const app = new Hono();

function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}

// Distance à vol d'oiseau importée depuis lib/geo.ts (voir plus haut)

app.get('/evenements', async (c) => {
  const lat = parseFloat(c.req.query('lat') || '');
  const lng = parseFloat(c.req.query('lng') || '');
  const rayonKm = Math.min(parseFloat(c.req.query('rayon') || '20'), 100);
  // Slug de la commune appelante, transmis par le client (window.COMMUNE_SLUG) — cette route
  // est publique et sans résolution de tenant, donc rien d'autre ne permet de savoir "d'où"
  // vient l'appel. But : ne jamais afficher sa propre commune dans "Autour de moi", déjà
  // visible dans l'onglet Agenda local juste à côté.
  const exclureSlug = c.req.query('exclure');
  if (isNaN(lat) || isNaN(lng)) return c.json({ erreur: 'Position (lat, lng) requise' }, 400);

  try {
    const toutesCommunes = await supabaseSelect(c.env, 'communes', {
      select: 'id,nom,slug,lat,lng,niveau_national', partage_regional: 'eq.true',
    });
    const communes = exclureSlug ? toutesCommunes.filter((commune: any) => commune.slug !== exclureSlug) : toutesCommunes;

    // Deux catégories bien distinctes : les communes "nationales" apparaissent toujours,
    // peu importe la distance (pas de coordonnées nécessaires) ; les communes locales sont
    // filtrées par rayon comme d'habitude. Number(...) en défense : PostgREST peut renvoyer
    // un type numeric en JSON sous forme de chaîne selon la colonne, et une valeur non
    // convertible (chaîne vide, texte...) donnerait NaN plutôt qu'une exception.
    const communesNationales = communes
      .filter((commune: any) => commune.niveau_national)
      .map((commune: any) => ({ ...commune, distance_km: null }));

    const communesLocales = communes
      .filter((commune: any) => !commune.niveau_national && commune.lat != null && commune.lng != null)
      .map((commune: any) => ({
        ...commune,
        distance_km: Math.round(distanceMetres(lat, lng, Number(commune.lat), Number(commune.lng)) / 1000),
      }))
      .filter((commune: any) => !isNaN(commune.distance_km) && commune.distance_km <= rayonKm);

    const communesProches = [...communesNationales, ...communesLocales];
    if (!communesProches.length) return c.json({ evenements: [], communes_participantes: 0 });

    const idsCommunes = communesProches.map((commune: any) => commune.id);
    const evenements = await supabaseSelect(c.env, 'events', {
      select: 'id,commune_id,titre,description,lieu,lat,lng,photo_url,date_debut,date_fin',
      commune_id: `in.(${idsCommunes.join(',')})`,
      officiel: 'eq.true',
      partage_autour: 'eq.true',
      date_fin: `gte.${new Date().toISOString()}`,
      order: 'date_debut.asc',
    });

    const result = evenements.map((e: any) => {
      const commune = communesProches.find((c: any) => c.id === e.commune_id);
      return {
        ...e,
        commune_nom: commune?.nom,
        commune_slug: commune?.slug,
        commune_distance_km: commune?.distance_km,
        commune_nationale: !!commune?.niveau_national,
      };
    });

    return c.json({ evenements: result, communes_participantes: communesProches.length });
  } catch (err) {
    console.error('Erreur /decouverte/evenements :', err);
    return c.json({ erreur: 'Impossible de charger les événements pour le moment.' }, 500);
  }
});

// ===================== Activation en self-service (page publique "rejoindre") =====================
// Page publique de plateforme-agora.fr où n'importe quel visiteur cherche sa commune et demande
// l'accès gratuit en indiquant juste son email (confirmation par email, voir plus bas) — sans
// attendre un email de prospection — voir frontend/rejoindre.html. S'appuie sur les 17 000+
// communes déjà en base (table prospects, alimentée par la prospection), jamais d'API externe.

// GET /decouverte/communes/rechercher?q=... — recherche publique par nom, aucune authentification.
app.get('/communes/rechercher', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ resultats: [] });

  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_postal,departement,commune_id',
    nom: `ilike.*${q}*`,
    order: 'nom.asc',
    limit: '10',
  });
  if (!prospects.length) return c.json({ resultats: [] });

  // Une commune est "déjà réclamée" si au moins un vrai compte (pas le compte générique
  // compte_provisionne créé automatiquement à la prospection) existe dessus — dans ce cas,
  // impossible pour un visiteur anonyme de se l'approprier (voir POST /communes/:id/demander-acces).
  const idsCommunes = [...new Set(prospects.map((p: any) => p.commune_id).filter(Boolean))];
  const comptesReels = idsCommunes.length ? await supabaseSelect(c.env, 'users', {
    select: 'commune_id', commune_id: `in.(${idsCommunes.join(',')})`, compte_provisionne: 'neq.true',
  }) : [];
  const communesReclamees = new Set(comptesReels.map((u: any) => u.commune_id));

  const resultats = prospects.map((p: any) => ({
    id: p.id, nom: p.nom, code_postal: p.code_postal, departement: p.departement,
    peut_demander_acces: !p.commune_id || !communesReclamees.has(p.commune_id),
  }));
  return c.json({ resultats });
});

const demandeAccesSchema = z.object({
  email: z.string().email(),
  consentement_rgpd: z.literal(true),
  // Piège à robots (honeypot), même principe que POST /:slug/auth/register.
  site_web: z.string().optional(),
});

// POST /decouverte/communes/:prospectId/demander-acces — le visiteur ne fait que renseigner son
// email. AUCUN compte n'est créé ici (zéro mot de passe choisi à ce stade, contrairement à la
// prospection par email vers les mairies où le "zéro friction" s'applique à l'activation
// elle-même, voir activerCommuneGratuite dans prospection.ts) : juste un jeton de confirmation
// (table activations_libres, migration 079) et un email avec un lien — décision explicite de
// Léandre le 2026-10-08, après une 1re version qui créait le compte trop tôt avec un nom
// générique. Le vrai compte n'est créé qu'au clic + à la validation du formulaire (voir
// POST /communes/activation/:token/creer-compte plus bas).
app.post('/communes/:prospectId/demander-acces', async (c) => {
  const body = demandeAccesSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;
  if (data.site_web) return c.json({ ok: true }); // honeypot : faux succès, rien créé

  const prospectId = c.req.param('prospectId');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,population,lat,lng,contact_email,commune_id',
    id: `eq.${prospectId}`,
  });
  if (!prospect) return c.json({ erreur: 'Commune introuvable' }, 404);

  let communeId: string = prospect.commune_id || '';

  if (!communeId) {
    const slug = await genererSlugUnique(c.env, prospect.nom);
    const [commune] = await supabaseInsert(c.env, 'communes', {
      nom: prospect.nom, slug,
      population: prospect.population ?? null,
      lat: prospect.lat ?? null, lng: prospect.lng ?? null,
      contact_email: prospect.contact_email ?? null,
      forfait: 'Gratuit', niveau_national: false,
    });
    communeId = commune.id;
    await appliquerOngletsSurCommune(c.env, communeId, await chargerOngletsGratuits(c.env));
    await supabaseUpdate(c.env, 'prospects', { commune_id: communeId }, { id: `eq.${prospect.id}` });
  } else {
    const [communeExistante] = await supabaseSelect(c.env, 'communes', { select: 'id', id: `eq.${communeId}` });
    if (!communeExistante) return c.json({ erreur: 'Commune introuvable' }, 404);
  }

  // Garde-fou : une commune déjà réclamée par un vrai utilisateur ne peut pas être redemandée.
  const [compteReel] = await supabaseSelect(c.env, 'users', {
    select: 'id', commune_id: `eq.${communeId}`, compte_provisionne: 'neq.true', limit: '1',
  });
  if (compteReel) {
    return c.json({ erreur: 'Cette commune utilise déjà Agora. Contactez-nous si vous pensez qu\'il s\'agit d\'une erreur.' }, 409);
  }

  const email = data.email.trim().toLowerCase();
  const token = genererRefreshToken();
  await supabaseInsert(c.env, 'activations_libres', {
    commune_id: communeId, email,
    token_hash: await hasherToken(token),
    expires_at: new Date(Date.now() + DUREE_TOKEN_ACTIVATION_MS).toISOString(),
  });

  const lienConfirmation = `${c.env.FRONTEND_URL}/rejoindre.html?token=${token}`;
  const html = emailConfirmationActivationHtml(prospect.nom, lienConfirmation);
  await envoyerEmail(c.env, email, `Confirmez la création de votre compte — ${prospect.nom}`, html);

  return c.json({ ok: true });
});

// GET /decouverte/communes/activation/:token — appelée par rejoindre.html quand elle est ouverte
// avec ?token=... : vérifie le jeton et renvoie de quoi afficher le formulaire de création
// (nom de la commune), sans jamais révéler l'email en clair dans l'URL.
app.get('/communes/activation/:token', async (c) => {
  const token = c.req.param('token');
  const [activation] = await supabaseSelect(c.env, 'activations_libres', {
    select: 'id,commune_id,email,expires_at,utilise_le',
    token_hash: `eq.${await hasherToken(token)}`,
  });
  if (!activation || activation.utilise_le || new Date(activation.expires_at) < new Date()) {
    return c.json({ erreur: 'Ce lien n\'est plus valable. Refaites une demande depuis la page Rejoindre.' }, 410);
  }
  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'nom', id: `eq.${activation.commune_id}` });
  return c.json({ nom_commune: commune?.nom, email: activation.email });
});

const creationCompteSchema = z.object({
  prenom: z.string().min(1).max(100),
  nom: z.string().min(1).max(100),
  mot_de_passe: z.string().min(6),
  consentement_rgpd: z.literal(true),
  site_web: z.string().optional(),
});

// POST /decouverte/communes/activation/:token/creer-compte — seule route de tout ce flux qui crée
// réellement un compte, avec le prénom/nom/mot de passe choisis par la personne elle-même (jamais
// un compte "Administration" générique). Connexion automatique immédiate à la validation, comme
// POST /:slug/auth/register — légitime ici car l'email a déjà été confirmé par le clic du lien.
app.post('/communes/activation/:token/creer-compte', async (c) => {
  const token = c.req.param('token');
  const body = creationCompteSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;
  if (data.site_web) return c.json({ ok: true, slug: '' }, 201); // honeypot

  const [activation] = await supabaseSelect(c.env, 'activations_libres', {
    select: 'id,commune_id,email,expires_at,utilise_le',
    token_hash: `eq.${await hasherToken(token)}`,
  });
  if (!activation || activation.utilise_le || new Date(activation.expires_at) < new Date()) {
    return c.json({ erreur: 'Ce lien n\'est plus valable. Refaites une demande depuis la page Rejoindre.' }, 410);
  }

  const communeId = activation.commune_id;
  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'slug', id: `eq.${communeId}` });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  // Re-vérifié ici (pas seulement à la demande) : protège contre deux confirmations concurrentes
  // sur la même commune (deux onglets, deux emails différents demandés coup sur coup...).
  const [compteReel] = await supabaseSelect(c.env, 'users', {
    select: 'id', commune_id: `eq.${communeId}`, compte_provisionne: 'neq.true', limit: '1',
  });
  if (compteReel) {
    return c.json({ erreur: 'Cette commune utilise déjà Agora. Contactez-nous si vous pensez qu\'il s\'agit d\'une erreur.' }, 409);
  }

  const password_hash = await hasherMotDePasse(data.mot_de_passe);

  // Réutilise le compte générique provisionné à la prospection (voir activerCommuneGratuite,
  // prospection.ts) s'il y en a un, plutôt que d'en créer un deuxième en double à côté.
  const [compteProvisionne] = await supabaseSelect(c.env, 'users', {
    select: 'id', commune_id: `eq.${communeId}`, compte_provisionne: 'eq.true', role: 'in.(admin,maire)',
  });

  let userId: string;
  if (compteProvisionne) {
    await supabaseUpdate(c.env, 'users', {
      email: activation.email, password_hash, prenom: data.prenom, nom: data.nom,
      compte_provisionne: false, consentement_rgpd_le: new Date().toISOString(),
    }, { id: `eq.${compteProvisionne.id}` });
    userId = compteProvisionne.id;
  } else {
    const [nouveauCompte] = await supabaseInsert(c.env, 'users', {
      commune_id: communeId, email: activation.email, password_hash,
      prenom: data.prenom, nom: data.nom, role: 'admin',
      consentement_rgpd_le: new Date().toISOString(),
    });
    userId = nouveauCompte.id;
  }

  await supabaseUpdate(c.env, 'activations_libres', { utilise_le: new Date().toISOString() }, { id: `eq.${activation.id}` });

  // Connexion automatique, même mécanisme que POST /:slug/auth/register.
  const accessToken = await sign(
    { user_id: userId, commune_id: communeId, role: 'admin', exp: Math.floor(Date.now() / 1000) + 900 },
    c.env.JWT_SECRET,
  );
  const refreshToken = genererRefreshToken();
  await supabaseInsert(c.env, 'refresh_tokens', {
    commune_id: communeId, user_id: userId,
    token_hash: await hasherToken(refreshToken),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  setCookie(c, 'agora_access', accessToken, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 900 });
  setCookie(c, 'agora_refresh', refreshToken, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 30 * 24 * 3600 });

  return c.json({ ok: true, slug: commune.slug }, 201);
});

const demandeManquanteSchema = z.object({
  nom_commune: z.string().min(1).max(200),
  email_demandeur: z.string().email().optional(),
  site_web: z.string().optional(),
});

// POST /decouverte/communes/demande-manquante — village introuvable dans la recherche : envoie
// une demande par email, remplace l'ancien lien mailto brut de accueil.html.
app.post('/communes/demande-manquante', async (c) => {
  const body = demandeManquanteSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (body.data.site_web) return c.json({ ok: true });

  await envoyerEmail(
    c.env, 'contact@plateforme-agora.fr', `Demande d'activation gratuite — ${body.data.nom_commune}`,
    `<p>Commune demandée : <strong>${echapper(body.data.nom_commune)}</strong></p>` +
    (body.data.email_demandeur
      ? `<p>Email du demandeur : ${echapper(body.data.email_demandeur)}</p>`
      : '<p>Aucun email fourni par le demandeur.</p>'),
  );
  return c.json({ ok: true });
});

export default app;

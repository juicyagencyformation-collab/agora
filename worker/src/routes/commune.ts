// worker/src/routes/commune.ts
import { estGestionnaire, peutGererRoles } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseUpdate, supabaseInsert } from '../db';
import { uploaderFichier, urlLogoVersionnee } from '../storage';
import { genererQrSvgUrl } from '../lib/qr-url';
import { deduireDepartement } from '../lib/geo';
import { marqueCommune, dimensionsPng } from '../lib/marque-commune';
import { infosFormule, demandeFormuleSchema, emailDemandeFormule, ROLES_DEMANDE_FORMULE } from '../lib/formule-commune';
import { envoyerEmail } from '../lib/email';

const app = new Hono();

app.get('/', async (c) => {
  const commune_id = c.get('commune_id_resolue') ?? c.get('commune_id');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'id,slug,nom,population,departement,couleur_theme,couleur_accent,logo_url,lat,lng,photo_jour_seuil_validations,photo_jour_max_par_jour,photo_jour_duree,rayon_validation_enigme,enigme_duree,mur_duree,contact_email,partage_regional,prochain_conseil_date,horaires_ouverture,permanences,telephone_mairie,email_mairie,acces_libre,espace_officiel,forfait,statut_client',
    id: `eq.${commune_id}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  // Le forfait et le statut client restent côté serveur : seul le résultat (marque ou non) sort.
  const { forfait, statut_client, ...publique } = commune;
  return c.json({ commune: { ...publique, marque: marqueCommune(commune) } });
});

// GET /rgpd — coordonnées de la mairie pour la politique de confidentialité de son espace
// (2026-11-25) : adresse et délégué à la protection des données (DPO), tels que renseignés dans le
// contrat DPA (table dpa_communes). Public : le RGPD impose de publier les coordonnées du DPO
// (art. 37.7). Seulement pour un espace géré par la mairie ; sinon l'éditeur est responsable.
app.get('/rgpd', async (c) => {
  const commune_id = c.get('commune_id_resolue') ?? c.get('commune_id');
  const [[commune], [dpa]] = await Promise.all([
    supabaseSelect(c.env, 'communes', { select: 'espace_officiel', id: `eq.${commune_id}` }),
    supabaseSelect(c.env, 'dpa_communes', { select: 'adresse_mairie,dpo', commune_id: `eq.${commune_id}` }),
  ]);
  if (!commune || commune.espace_officiel === false) return c.json({ adresse_mairie: null, dpo: null });
  return c.json({ adresse_mairie: dpa?.adresse_mairie || null, dpo: dpa?.dpo || null });
});

// GET /qr — QR code de l'URL publique de la commune, pour qu'un citoyen le montre à un voisin
// (bouton dans Profil). Public comme GET / : ce n'est que l'URL publique de la commune.
app.get('/qr', async (c) => {
  const slug = c.get('slug_commune');
  const url = `${c.env.FRONTEND_URL}/${slug}/`;
  const svg = genererQrSvgUrl(url);
  return c.json({ url, svg });
});

// Photo du jour, Énigme photo, Mur des voisins, Découverte régionale.
export const CHAMPS_REGLAGES_SUPERADMIN = [
  'photo_jour_seuil_validations', 'photo_jour_max_par_jour', 'photo_jour_duree',
  'rayon_validation_enigme', 'enigme_duree', 'mur_duree', 'partage_regional',
] as const;

app.patch('/', jwtMiddleware, async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');

  const schema = z.object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    nom: z.string().min(1).max(120).optional(),
    // Code département (ex. "80", "2A") — sert uniquement à cibler le bon bulletin de
    // vigilance météo lors de la synchro automatique (lib/vigilance-meteofrance.ts).
    departement: z.string().trim().regex(/^[0-9][0-9AB]$|^97[1-6]$/i).optional(),
    couleur_theme: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    couleur_accent: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    photo_jour_seuil_validations: z.number().int().min(1).max(30).optional(),
    photo_jour_max_par_jour: z.number().int().min(1).max(10).optional(),
    photo_jour_duree: z.enum(['jour', 'semaine', 'mois']).optional(),
    rayon_validation_enigme: z.number().int().min(5).max(500).optional(),
    enigme_duree: z.enum(['48h', 'semaine', 'mois', '6mois', 'an']).optional(),
    mur_duree: z.enum(['24h', '48h']).optional(),
    contact_email: z.string().email().optional(),
    partage_regional: z.boolean().optional(),
    prochain_conseil_date: z.string().datetime().optional().nullable(),
  });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  // Réglages techniques des modules : superadmin uniquement, comme leurs volets dans « Ma commune »
  // (masqués aux autres rôles). Sans ce contrôle, le masquage n'était qu'à l'écran (2026-11-17).
  if (role !== 'superadmin' && CHAMPS_REGLAGES_SUPERADMIN.some((champ) => body.data[champ] !== undefined)) {
    return c.json({ erreur: 'Réglage réservé à l’équipe Plateforme-Agora' }, 403);
  }

  const patch: Record<string, unknown> = { ...body.data };

  // Département déduit automatiquement des coordonnées (pour la synchro vigilance météo) —
  // seulement si les coordonnées changent ET que l'appelant n'a pas lui-même fourni de
  // département (un envoi explicite reste une correction manuelle prioritaire, ex. commune
  // à cheval sur deux départements que l'API situerait mal).
  if ((body.data.lat !== undefined || body.data.lng !== undefined) && body.data.departement === undefined) {
    const [actuelle] = await supabaseSelect(c.env, 'communes', { select: 'lat,lng', id: `eq.${commune_id}` });
    const lat = body.data.lat ?? actuelle?.lat;
    const lng = body.data.lng ?? actuelle?.lng;
    if (lat != null && lng != null) {
      const departementDeduit = await deduireDepartement(lat, lng);
      if (departementDeduit) patch.departement = departementDeduit;
    }
  }

  await supabaseUpdate(c.env, 'communes', patch, { id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// PATCH /infos-mairie — horaires, permanences, téléphone, email de la mairie affichés en bas
// de l'accueil. Réservé aux élus, au maire et au superadmin (pas les admins) : ce sont des
// informations officielles engageant la mairie. Chaîne vide = efface le champ.
app.patch('/infos-mairie', jwtMiddleware, async (c) => {
  const role = c.get('role');
  if (!peutGererRoles(role)) {
    return c.json({ erreur: 'Réservé aux élus et au maire' }, 403);
  }
  const commune_id = c.get('commune_id');

  const schema = z.object({
    horaires_ouverture: z.string().max(2000).optional(),
    permanences: z.string().max(2000).optional(),
    telephone_mairie: z.string().max(500).optional(),
    email_mairie: z.string().max(200).optional(),
  });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const patch: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(body.data)) {
    patch[cle] = (typeof valeur === 'string' && valeur.trim()) ? valeur.trim() : null;
  }
  if (Object.keys(patch).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  await supabaseUpdate(c.env, 'communes', patch, { id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// POST /logo — réservé aux élus, au maire et au superadmin (pas les admins) : le logo
// engage l'image officielle de la commune, plus sensible qu'un réglage de contenu courant.
app.post('/logo', jwtMiddleware, async (c) => {
  const role = c.get('role');
  if (!peutGererRoles(role)) {
    return c.json({ erreur: 'Réservé aux élus, au maire et au superadmin' }, 403);
  }
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png)$/.test(contentType)) {
    return c.json({ erreur: 'Format non autorisé (JPEG ou PNG uniquement)' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 4 * 1024 * 1024) {
    return c.json({ erreur: 'Image trop lourde (max 4 Mo)' }, 400);
  }
  const extension = contentType.split('/')[1];
  // Clé fixe (pas d'UUID) : un nouvel upload remplace directement l'ancien logo dans R2 —
  // un seul logo par commune, inutile de suivre/supprimer un ancien fichier séparément.
  const key = `${commune_id}/logo.${extension}`;
  const url = urlLogoVersionnee(await uploaderFichier(c.env, key, donnees, contentType));
  await supabaseUpdate(c.env, 'communes', { logo_url: url }, { id: `eq.${commune_id}` });
  return c.json({ ok: true, logo_url: url });
});

// POST /logo/icone — icône carrée de l'appli installée (voir lib/marque-commune.ts), envoyée par
// le navigateur juste AVANT le logo : PNG carré, 192 à 1024 px, mêmes droits que le logo.
app.post('/logo/icone', jwtMiddleware, async (c) => {
  if (!peutGererRoles(c.get('role'))) {
    return c.json({ erreur: 'Réservé aux élus, au maire et au superadmin' }, 403);
  }
  const commune_id = c.get('commune_id');
  if ((c.req.header('Content-Type') || '') !== 'image/png') return c.json({ erreur: 'PNG uniquement' }, 400);
  const donnees = await c.req.arrayBuffer();
  const taille = dimensionsPng(new Uint8Array(donnees));
  if (donnees.byteLength > 1024 * 1024 || !taille || taille.largeur !== taille.hauteur || taille.largeur < 192 || taille.largeur > 1024) {
    return c.json({ erreur: 'Icône invalide (PNG carré de 192 à 1024 px, 1 Mo maximum)' }, 400);
  }
  await uploaderFichier(c.env, `${commune_id}/icone.png`, donnees, 'image/png');
  return c.json({ ok: true });
});

// ── Volet « Votre formule » (2026-11-18, migration 105, logique dans lib/formule-commune.ts) ──

// GET /formule — formule actuelle, onglets inclus/verrouillés, prix de la commune, demande en cours.
// Gestionnaires uniquement (l'onglet Ma commune leur est réservé) ; seuls maire/élus peuvent demander.
app.get('/formule', jwtMiddleware, async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  return c.json(await infosFormule(c.env, c.get('commune_id'), role));
});

// POST /demande-formule — le maire ou un élu demande à changer de formule. Rien ne s'active :
// une ligne en base (visible dans le backoffice) et un email à l'équipe, qui rappelle.
app.post('/demande-formule', jwtMiddleware, async (c) => {
  const role = c.get('role');
  if (!ROLES_DEMANDE_FORMULE.includes(role)) return c.json({ erreur: 'Seuls le maire et les élus peuvent faire cette demande.' }, 403);
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const body = demandeFormuleSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: 'Merci de vérifier le téléphone et la formule choisie.' }, 400);

  const infos = await infosFormule(c.env, commune_id, role);
  if (infos.demande_en_cours) return c.json({ erreur: 'Une demande est déjà en cours : nous vous rappelons très vite.' }, 409);
  if (!infos.peut_demander) return c.json({ erreur: 'Votre commune a déjà accès à toutes les fonctionnalités.' }, 400);

  // Ancienne demande restée en attente au-delà de sa validité : close, sinon l'index unique
  // (une seule demande en attente par commune) refuserait la nouvelle.
  await supabaseUpdate(c.env, 'demandes_formule', { statut: 'traitee', traitee_le: new Date().toISOString() }, {
    commune_id: `eq.${commune_id}`, statut: 'eq.en_attente',
  });
  const [demande] = await supabaseInsert(c.env, 'demandes_formule', {
    commune_id, user_id, formule_souhaitee: body.data.formule_souhaitee,
    telephone: body.data.telephone, message: body.data.message || null,
  });

  const [[commune], [demandeur]] = await Promise.all([
    supabaseSelect(c.env, 'communes', { select: 'nom,population', id: `eq.${commune_id}` }),
    supabaseSelect(c.env, 'users', { select: 'prenom,nom,email', id: `eq.${user_id}`, commune_id: `eq.${commune_id}` }),
  ]);
  const { sujet, html } = emailDemandeFormule({
    commune: commune?.nom ?? '', population: commune?.population ?? null, formule_actuelle: infos.formule,
    formule_souhaitee: body.data.formule_souhaitee, demandeur: `${demandeur?.prenom ?? ''} ${demandeur?.nom ?? ''}`.trim(),
    role, email: demandeur?.email ?? '', telephone: body.data.telephone, message: body.data.message,
  });
  // L'email ne bloque jamais : la demande est enregistrée et visible dans le backoffice.
  c.executionCtx.waitUntil(envoyerEmail(c.env, c.env.EMAIL_CONTACT || 'contact@plateforme-agora.fr', sujet, html, undefined, demandeur?.email || undefined));

  return c.json({ ok: true, demande: { formule_souhaitee: demande.formule_souhaitee, created_at: demande.created_at } }, 201);
});

export default app;

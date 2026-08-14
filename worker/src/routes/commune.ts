// worker/src/routes/commune.ts
import { estGestionnaire, peutGererRoles } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseUpdate } from '../db';
import { uploaderFichier } from '../storage';
import { genererQrSvgUrl } from '../lib/qr-url';

const app = new Hono();

app.get('/', async (c) => {
  const commune_id = c.get('commune_id_resolue') ?? c.get('commune_id');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'id,slug,nom,population,couleur_theme,couleur_accent,logo_url,lat,lng,photo_jour_seuil_validations,photo_jour_max_par_jour,photo_jour_duree,rayon_validation_enigme,enigme_duree,mur_duree,contact_email,partage_regional,prochain_conseil_date,horaires_ouverture,permanences,telephone_mairie,email_mairie',
    id: `eq.${commune_id}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  return c.json({ commune });
});

// GET /qr — QR code de l'URL publique de la commune, pour qu'un citoyen le montre à un voisin
// (bouton dans Profil). Public comme GET / : ce n'est que l'URL publique de la commune.
app.get('/qr', async (c) => {
  const slug = c.get('slug_commune');
  const url = `${c.env.FRONTEND_URL}/${slug}/`;
  const svg = genererQrSvgUrl(url);
  return c.json({ url, svg });
});

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

  await supabaseUpdate(c.env, 'communes', body.data, { id: `eq.${commune_id}` });
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
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  await supabaseUpdate(c.env, 'communes', { logo_url: url }, { id: `eq.${commune_id}` });
  return c.json({ ok: true, logo_url: url });
});

export default app;

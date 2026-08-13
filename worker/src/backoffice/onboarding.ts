// worker/src/backoffice/onboarding.ts
// Phase 3 du backoffice : transformer un prospect gagné en commune cliente. Crée la ligne
// communes + le compte maire (rôle 'maire' — attribution légitime ici car le staff backoffice
// est l'équivalent superadmin, seul habilité à nommer un maire), puis relie le prospect.
// Les onglets restent actifs par défaut : le code considère une commune sans ligne
// onglets_config comme tout-actif (voir routes/moderation.ts), rien à insérer.
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';
import { hasherMotDePasse } from '../lib/password';
import { backofficeMiddleware } from '../middleware/backoffice';
import { envoyerEmailBienvenue } from './email-commune';

const app = new Hono();
app.use('*', backofficeMiddleware);

const creerSchema = z.object({
  prospect_id: z.string().uuid().optional(),
  nom: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug invalide (minuscules, chiffres et tirets)').min(2).max(60),
  population: z.number().int().positive().optional().nullable(),
  maire: z.object({
    email: z.string().email(),
    nom: z.string().min(1).max(100),
    prenom: z.string().min(1).max(100),
    password: z.string().min(6).max(200),
  }),
  envoyer_email: z.boolean().optional(),
});

app.post('/creer', async (c) => {
  const body = creerSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const { prospect_id, nom, slug, population, maire, envoyer_email } = body.data;

  // Slug unique : c'est l'identifiant d'URL de la commune (plateforme-agora.fr/<slug>/).
  const [slugPris] = await supabaseSelect(c.env, 'communes', { select: 'id', slug: `eq.${slug}` });
  if (slugPris) return c.json({ erreur: `Le slug « ${slug} » est déjà utilisé par une autre commune.` }, 409);

  // Coordonnées du centre de la commune (pour la météo, la carte...). Récupérées depuis
  // geo.api.gouv.fr via le code INSEE du prospect. Sans coordonnées, l'app retombe sur une
  // position par défaut erronée (météo d'une autre ville). Non bloquant : en cas d'échec, la
  // mairie pourra les renseigner depuis les réglages de la commune.
  let lat: number | null = null;
  let lng: number | null = null;
  if (prospect_id) {
    const [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'code_insee', id: `eq.${prospect_id}` });
    if (prospect?.code_insee) {
      try {
        const res = await fetch(`https://geo.api.gouv.fr/communes/${prospect.code_insee}?fields=centre&format=json`);
        if (res.ok) {
          const coords = ((await res.json()) as any)?.centre?.coordinates; // [lng, lat]
          if (Array.isArray(coords) && coords.length === 2) { lng = coords[0]; lat = coords[1]; }
        }
      } catch { /* coordonnées optionnelles */ }
    }
  }

  const [commune] = await supabaseInsert(c.env, 'communes', {
    slug, nom,
    population: population ?? null,
    lat, lng,
    niveau_national: false,
  });

  // Compte maire. consentement_rgpd_le renseigné : compte pro créé dans un cadre contractuel.
  const password_hash = await hasherMotDePasse(maire.password);
  const [utilisateurMaire] = await supabaseInsert(c.env, 'users', {
    commune_id: commune.id,
    email: maire.email,
    password_hash,
    nom: maire.nom,
    prenom: maire.prenom,
    role: 'maire',
    consentement_rgpd_le: new Date().toISOString(),
  });

  // Rattache le prospect gagné, s'il vient d'une fiche prospect.
  if (prospect_id) {
    await supabaseUpdate(c.env, 'prospects',
      { commune_id: commune.id, statut: 'gagne', updated_at: new Date().toISOString() },
      { id: `eq.${prospect_id}` });
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id, staff_id: c.get('staff_id'),
      type: 'statut', contenu: `Commune cliente créée (${slug}), maire : ${maire.email}`,
    });
  }

  // Email de bienvenue au maire avec ses identifiants provisoires (le mot de passe en clair
  // n'est disponible qu'ici, avant hachage). Non bloquant : envoyerEmail échoue silencieusement.
  if (envoyer_email) {
    await envoyerEmailBienvenue(c.env, {
      nomCommune: nom, slug, maireEmail: maire.email, motDePasse: maire.password,
      frontendUrl: c.env.FRONTEND_URL,
    });
  }

  return c.json({
    ok: true,
    commune: { id: commune.id, slug: commune.slug, nom: commune.nom },
    maire_id: utilisateurMaire.id,
    url: `${c.env.FRONTEND_URL}/${commune.slug}/`,
  }, 201);
});

export default app;

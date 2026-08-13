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
});

app.post('/creer', async (c) => {
  const body = creerSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const { prospect_id, nom, slug, population, maire } = body.data;

  // Slug unique : c'est l'identifiant d'URL de la commune (plateforme-agora.fr/<slug>/).
  const [slugPris] = await supabaseSelect(c.env, 'communes', { select: 'id', slug: `eq.${slug}` });
  if (slugPris) return c.json({ erreur: `Le slug « ${slug} » est déjà utilisé par une autre commune.` }, 409);

  const [commune] = await supabaseInsert(c.env, 'communes', {
    slug, nom,
    population: population ?? null,
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

  return c.json({
    ok: true,
    commune: { id: commune.id, slug: commune.slug, nom: commune.nom },
    maire_id: utilisateurMaire.id,
    url: `${c.env.FRONTEND_URL}/${commune.slug}/`,
  }, 201);
});

export default app;

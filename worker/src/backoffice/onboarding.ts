// worker/src/backoffice/onboarding.ts
// Phase 3 du backoffice : transformer un prospect gagné en commune cliente. Crée la ligne
// communes + le compte maire (rôle 'maire' — attribution légitime ici car le staff backoffice
// est l'équivalent superadmin, seul habilité à nommer un maire), puis relie le prospect.
// Forfait Gratuit par défaut (avec le périmètre de modules qui va avec, voir
// appliquerOngletsSurCommune) — décidé le 2026-08-19 : avant cette date, la commune n'avait
// aucun forfait tant que le staff ne cliquait pas ensuite sur "Passer en Gratuit"/"Version
// complète" sur sa fiche, ce qui a piégé un test de la séquence d'onboarding/upsell (celle-ci
// ignore toute commune sans forfait='Gratuit'). Passer en Version complète reste un choix
// explicite a posteriori sur la fiche, comme avant.
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';
import { hasherMotDePasse } from '../lib/password';
import { backofficeMiddleware } from '../middleware/backoffice';
import { envoyerEmailBienvenue, envoyerBienvenueInscription, envoyerRelanceInactivite, contextePresentation } from './email-commune';
import { chargerOngletsGratuits, appliquerOngletsSurCommune } from './administration';

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
    forfait: 'Gratuit',
  });
  await appliquerOngletsSurCommune(c.env, commune.id, await chargerOngletsGratuits(c.env));

  // Compte maire. consentement_rgpd_le renseigné : compte pro créé dans un cadre contractuel.
  const password_hash = await hasherMotDePasse(maire.password);
  const [utilisateurMaire] = await supabaseInsert(c.env, 'users', {
    commune_id: commune.id,
    // Normalisé (espaces + casse) — un email tapé/collé avec une casse différente au moment
    // de la connexion ne doit jamais être bloqué (voir aussi auth.ts /login, ilike).
    email: maire.email.trim().toLowerCase(),
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

// Déclenché à la toute première inscription citoyenne (hors compte Maire pré-créé) dans une
// commune activée via la prospection — signal d'engagement bien plus fort que l'envoi de
// l'email de présentation lui-même (voir POST /auth/register côté citoyen). Idempotent via
// communes.premiere_inscription_citoyen_le (jamais renvoyé deux fois). N'échoue jamais
// bruyamment : un email de bienvenue raté ne doit jamais casser une inscription citoyenne.
export async function declencherBienvenuePremiereInscription(
  env: any, commune_id: string, nouvelUtilisateur: { id: string; email: string; nom: string; prenom: string },
): Promise<void> {
  try {
    const [commune] = await supabaseSelect(env, 'communes', {
      select: 'id,nom,slug,premiere_inscription_citoyen_le', id: `eq.${commune_id}`,
    });
    if (!commune || commune.premiere_inscription_citoyen_le) return; // déjà déclenché, ou commune introuvable

    // Un autre compte citoyen existait-il déjà dans cette commune (le compte Maire ne compte
    // pas, role='maire') ? Si oui, ce n'est pas la première inscription.
    const autresCitoyens = await supabaseSelect(env, 'users', {
      select: 'id', commune_id: `eq.${commune_id}`, role: 'eq.citoyen', id: `neq.${nouvelUtilisateur.id}`, limit: '1',
    });
    if (autresCitoyens.length) return;

    // La commune doit être issue de la prospection : sans prospect lié, pas de contexte
    // commercial (ex. commune de démo/nationale, ou créée manuellement hors backoffice).
    const [prospect] = await supabaseSelect(env, 'prospects', { select: 'id', commune_id: `eq.${commune_id}` });
    if (!prospect) return;

    await supabaseUpdate(env, 'communes', { premiere_inscription_citoyen_le: new Date().toISOString() }, { id: `eq.${commune_id}` });

    const ctx = contextePresentation(env.FRONTEND_URL, commune.nom, commune.slug);
    await envoyerBienvenueInscription(env, nouvelUtilisateur.email, ctx);

    await supabaseInsert(env, 'prospect_interactions', {
      prospect_id: prospect.id, staff_id: null, type: 'email',
      contenu: `Premier compte citoyen créé (${nouvelUtilisateur.prenom} ${nouvelUtilisateur.nom}, ${nouvelUtilisateur.email}) — message de bienvenue envoyé automatiquement.`,
    });
  } catch (err) {
    console.error('declencherBienvenuePremiereInscription a échoué :', err);
  }
}

// Relance douce si un citoyen s'est inscrit une fois puis que personne n'est revenu depuis dans
// la commune (signal inverse à declencherBienvenuePremiereInscription, tout aussi utile) :
// fenêtre de 5 à 9 jours après la première inscription, pour ne relancer ni trop tôt ni
// indéfiniment. Idempotente via prospect_interactions (jamais renvoyée deux fois pour la même
// commune). Appelée depuis le cron quotidien (voir cron.ts).
export async function verifierRelanceInactivite(env: any): Promise<void> {
  const il5 = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const il9 = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();

  const communes = await supabaseSelect(env, 'communes', {
    select: 'id,nom,slug,premiere_inscription_citoyen_le',
    premiere_inscription_citoyen_le: `lte.${il5}`,
  });
  const candidates = communes.filter((cm: any) => cm.premiere_inscription_citoyen_le >= il9);
  if (!candidates.length) return;

  const seuilActivite = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  for (const commune of candidates) {
    try {
      const utilisateursActifs = await supabaseSelect(env, 'users', {
        select: 'id', commune_id: `eq.${commune.id}`, derniere_connexion_streak: `gte.${seuilActivite}`, limit: '1',
      });
      if (utilisateursActifs.length) continue; // quelqu'un est revenu récemment, rien à faire

      const [prospect] = await supabaseSelect(env, 'prospects', {
        select: 'id,contact_email', commune_id: `eq.${commune.id}`,
      });
      if (!prospect?.contact_email) continue;

      const dejaEnvoyee = await supabaseSelect(env, 'prospect_interactions', {
        select: 'id', prospect_id: `eq.${prospect.id}`, contenu: 'ilike.Relance douce*', limit: '1',
      });
      if (dejaEnvoyee.length) continue;

      const ctx = contextePresentation(env.FRONTEND_URL, commune.nom, commune.slug);
      await envoyerRelanceInactivite(env, prospect.contact_email, ctx);

      await supabaseInsert(env, 'prospect_interactions', {
        prospect_id: prospect.id, staff_id: null, type: 'email',
        contenu: `Relance douce envoyée automatiquement (inscrit le ${commune.premiere_inscription_citoyen_le.slice(0, 10)}, sans retour depuis).`,
      });
    } catch (err) {
      console.error(`verifierRelanceInactivite a échoué pour la commune ${commune.id} :`, err);
    }
  }
}

export default app;

// worker/src/backoffice/plaquette.ts
// Plaquette de présentation personnalisée pour UNE commune (2026-11-23, demandé par Léandre) :
// page imprimable du backoffice (frontend/backoffice/plaquette.html), ouverte depuis l'onglet
// « Échanges » d'une fiche prospect ou depuis une fiche commune, avant l'envoi d'un mail.
// Tout ce qui varie vient d'ici, jamais écrit en dur dans la page :
// - la commune (nom, adresse de l'appli, habitants, logo, couleurs) ;
// - le barème et les textes des offres (Réglages → Tarification, tarification.ts) ;
// - les onglets du palier gratuit (Réglages, table onglets_gratuits) ;
// - l'offre fondatrice : places restantes, prix de la convention s'il est plus bas que le barème.
// Lecture seule, session staff (backofficeMiddleware).
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { NOMS_DEPARTEMENTS } from '../lib/regions';
import { chargerOngletsGratuits } from './administration';
import {
  chargerBareme, chargerOffresTexte, structurerOffresTexte, calculerPrixAutonomie, calculerPrixAccompagne,
  calculerPrixFondateur, estGratuitAVie, estSurDevis,
} from './tarification';

// Offre « Commune fondatrice » telle qu'annoncée publiquement : 10 places, jusqu'au 31 mars 2027.
export const PLACES_FONDATRICES = 10;
export const FIN_OFFRE_FONDATRICE = '2027-03-31';

const app = new Hono();
app.use('*', backofficeMiddleware);

const requeteSchema = z.object({
  prospect: z.string().uuid().optional(),
  commune: z.string().uuid().optional(),
}).refine((q) => !!q.prospect !== !!q.commune, 'Indiquer un prospect OU une commune.');

const COLONNES_COMMUNE = 'id,nom,slug,population,departement,logo_url,couleur_theme,couleur_accent,forfait';

app.get('/', async (c) => {
  const q = requeteSchema.safeParse({ prospect: c.req.query('prospect') || undefined, commune: c.req.query('commune') || undefined });
  if (!q.success) return c.json({ erreur: q.error.issues[0]?.message ?? 'Paramètres invalides' }, 400);

  let prospect: any = null;
  let commune: any = null;
  if (q.data.prospect) {
    [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'nom,departement,population,commune_id', id: `eq.${q.data.prospect}` });
    if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);
    if (prospect.commune_id) [commune] = await supabaseSelect(c.env, 'communes', { select: COLONNES_COMMUNE, id: `eq.${prospect.commune_id}` });
  } else {
    [commune] = await supabaseSelect(c.env, 'communes', { select: COLONNES_COMMUNE, id: `eq.${q.data.commune}` });
    if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  }

  const communeId = commune?.id ?? null;
  const [bareme, offresBrutes, ongletsGratuits, prises, conventions] = await Promise.all([
    chargerBareme(c.env),
    chargerOffresTexte(c.env),
    chargerOngletsGratuits(c.env),
    supabaseSelect(c.env, 'conventions', { select: 'commune_id', statut: 'neq.annulee', numero_fondatrice: 'not.is.null' }),
    communeId
      ? supabaseSelect(c.env, 'conventions', { select: 'prix_annuel_fondateur,statut', commune_id: `eq.${communeId}`, statut: 'neq.annulee' })
      : Promise.resolve([] as any[]),
  ]);

  const nom = commune?.nom || prospect?.nom || '';
  const habitants = Number(commune?.population || prospect?.population || 0) || 0;
  const departement = String(commune?.departement || prospect?.departement || '').toUpperCase();
  const surDevis = estSurDevis(habitants, bareme);
  const gratuiteAVie = estGratuitAVie(habitants, bareme);
  const autonomie = calculerPrixAutonomie(habitants, bareme);
  const accompagne = calculerPrixAccompagne(habitants, bareme);

  // Fondatrice : le prix de la convention de la commune prime s'il est plus bas que le barème −35 %
  // (même règle que prixConvention dans backoffice/js/app.js).
  const [convention] = conventions;
  const prixConvention = Number(convention?.prix_annuel_fondateur) > 0 ? Number(convention.prix_annuel_fondateur) : null;
  const fondateurAutonomie = gratuiteAVie ? 0
    : prixConvention !== null ? Math.min(prixConvention, calculerPrixFondateur(autonomie)) : calculerPrixFondateur(autonomie);
  const placesRestantes = Math.max(0, PLACES_FONDATRICES - prises.filter((p: any) => p.commune_id !== communeId).length - (convention ? 1 : 0));
  const offreOuverte = new Date().toISOString().slice(0, 10) <= FIN_OFFRE_FONDATRICE;

  return c.json({
    commune: {
      nom,
      slug: commune?.slug ?? null,
      habitants,
      departement,
      departement_nom: NOMS_DEPARTEMENTS[departement] ?? null,
      logo_url: commune?.logo_url ?? null,
      couleur_theme: commune?.couleur_theme ?? null,
      couleur_accent: commune?.couleur_accent ?? null,
    },
    tarifs: {
      sur_devis: surDevis,
      gratuite_a_vie: gratuiteAVie,
      population_connue: habitants > 0,
      autonomie: Math.round(autonomie),
      accompagne: Math.round(accompagne),
      fondateur_autonomie: fondateurAutonomie,
      fondateur_accompagne: calculerPrixFondateur(accompagne),
      prix_convention: prixConvention !== null && prixConvention <= calculerPrixFondateur(autonomie),
      bareme: {
        plancher: bareme.prix_plancher, seuil_degressif: bareme.seuil_degressif,
        par_tranche_de_100: Math.round(bareme.taux_degressif * 100 * 100) / 100,
        supplement_accompagne: bareme.supplement_accompagne, seuil_devis: bareme.seuil_devis, seuil_gratuite: bareme.seuil_gratuite,
      },
    },
    offres: structurerOffresTexte(offresBrutes),
    onglets_gratuits: ongletsGratuits,
    fondatrice: {
      proposee: !surDevis && offreOuverte && (placesRestantes > 0 || !!convention),
      convention_en_cours: !!convention,
      places_restantes: placesRestantes,
      places_total: PLACES_FONDATRICES,
      fin: FIN_OFFRE_FONDATRICE,
    },
  });
});

export default app;

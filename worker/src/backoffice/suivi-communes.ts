// worker/src/backoffice/suivi-communes.ts
// Étape 1 du remaniement du backoffice (2026-11-03, avec Léandre) : rendre visible tout seul ce
// qu'on découvrait jusqu'ici en fouillant la base.
// - GET /anomalies : incohérences entre forfait, formule, convention, DPA, prix (page Aujourd'hui) ;
// - GET /communes/:id/demarrage : liste de démarrage d'une commune, cochée automatiquement à
//   partir de ce qui existe en base (fiche commune).
// Lecture seule : rien n'est modifié ici.
import { Hono } from 'hono';
import { backofficeMiddleware } from '../middleware/backoffice';
import { supabaseSelect, supabaseCount } from '../db';
import { infosContratDpa } from './facturation';

const app = new Hono();
app.use('*', backofficeMiddleware);

// Au-delà, la page d'accueil du site dit « nous consulter » : une fondatrice plus grande est
// probablement une erreur de saisie ou un test (cas d'Istres, 44 000 habitants, 2026-11-03).
const POPULATION_MAX_FONDATRICE = 8000;
const PLACES_FONDATRICES = 10;
const JOURS_CONVENTION_EN_ATTENTE = 30;

export type Anomalie = { code: string; gravite: 'haute' | 'moyenne' | 'info'; commune_id: string | null; commune_nom: string | null; commune_slug: string | null; message: string };

// Communes réellement suivies : fondatrices et payantes, hors démo, commune nationale et test.
async function communesSuivies(env: any) {
  const communes = await supabaseSelect(env, 'communes', {
    select: 'id,nom,slug,forfait,formule,statut_client,prix_annuel_ttc,population',
    forfait: 'not.in.(Gratuit)', niveau_national: 'not.is.true', acces_libre: 'not.is.true', slug: 'neq.test',
    order: 'nom.asc',
  });
  return communes.filter((cm: any) => cm.forfait && cm.statut_client !== 'resiliee');
}

const estPayante = (cm: any) => cm.forfait !== 'Fondateur';
const normaliserNom = (nom: string) => nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Règles pures, testables sans base : prend les données déjà lues, renvoie les anomalies.
export function detecterAnomalies(
  communes: any[], conventions: any[], dpaManquants: Map<string, number>, maintenant = Date.now(),
): Anomalie[] {
  const anomalies: Anomalie[] = [];
  const ajouter = (code: string, gravite: Anomalie['gravite'], cm: any, message: string) =>
    anomalies.push({ code, gravite, commune_id: cm?.id ?? null, commune_nom: cm?.nom ?? null, commune_slug: cm?.slug ?? null, message });

  for (const cm of communes) {
    if (!cm.formule) {
      ajouter('formule_manquante', 'haute', cm, 'Aucune formule enregistrée : ni modération automatique des photos, ni bilan mensuel.');
    }
    if (estPayante(cm) && cm.statut_client === 'active' && !cm.prix_annuel_ttc) {
      ajouter('prix_manquant', 'haute', cm, `Forfait « ${cm.forfait} » sans prix annuel : absente du chiffre d'affaires prévu.`);
    }
    const sesConventions = conventions.filter((cv) => cv.commune_id === cm.id && cv.statut !== 'annulee');
    if (cm.forfait === 'Fondateur') {
      if (!sesConventions.length) {
        ajouter('convention_manquante', 'moyenne', cm, 'Commune fondatrice sans convention.');
      }
      if ((cm.population ?? 0) > POPULATION_MAX_FONDATRICE) {
        ajouter('fondatrice_hors_cible', 'moyenne', cm, `Commune fondatrice de ${cm.population.toLocaleString('fr-FR')} habitants : au-delà de ${POPULATION_MAX_FONDATRICE.toLocaleString('fr-FR')}, l'offre est sur devis. Erreur ou test ?`);
      }
    }
    for (const cv of sesConventions) {
      const jours = Math.floor((maintenant - new Date(cv.created_at).getTime()) / 86400000);
      if (['brouillon', 'envoyee'].includes(cv.statut) && jours > JOURS_CONVENTION_EN_ATTENTE) {
        ajouter('convention_en_attente', 'info', cm, `Convention ${cv.statut === 'brouillon' ? 'en brouillon' : 'envoyée, non signée'} depuis ${jours} jours.`);
      }
    }
    const manquants = dpaManquants.get(cm.id) ?? 0;
    if (manquants > 0) {
      ajouter('dpa_incomplet', 'moyenne', cm, `Contrat DPA : ${manquants} information(s) manquante(s).`);
    }
  }

  const parNom = new Map<string, any[]>();
  for (const cm of communes) parNom.set(normaliserNom(cm.nom), [...(parNom.get(normaliserNom(cm.nom)) ?? []), cm]);
  for (const doublons of parNom.values()) {
    if (doublons.length < 2) continue;
    for (const cm of doublons) {
      ajouter('doublon', 'moyenne', cm, `Existe en ${doublons.length} exemplaires (adresses : ${doublons.map((d) => '/' + d.slug).join(', ')}).`);
    }
  }

  const fondatrices = communes.filter((cm) => cm.forfait === 'Fondateur').length;
  if (fondatrices > PLACES_FONDATRICES) {
    ajouter('places_fondatrices', 'moyenne', null, `${fondatrices} communes au forfait Fondateur pour ${PLACES_FONDATRICES} places annoncées.`);
  }

  const ordre = { haute: 0, moyenne: 1, info: 2 };
  return anomalies.sort((a, b) => ordre[a.gravite] - ordre[b.gravite] || (a.commune_nom ?? '').localeCompare(b.commune_nom ?? ''));
}

app.get('/anomalies', async (c) => {
  const communes = await communesSuivies(c.env);
  const ids = communes.map((cm: any) => cm.id);
  if (!ids.length) return c.json({ anomalies: [] });
  const [conventions, dpas] = await Promise.all([
    supabaseSelect(c.env, 'conventions', { select: 'commune_id,statut,created_at', commune_id: `in.(${ids.join(',')})` }),
    Promise.all(ids.map((id: string) => infosContratDpa(c.env, id))),
  ]);
  const dpaManquants = new Map<string, number>();
  dpas.forEach((d, i) => { if (d) dpaManquants.set(ids[i], d.champs.filter((ch: any) => !ch.valeur).length); });
  return c.json({ anomalies: detecterAnomalies(communes, conventions, dpaManquants) });
});

// GET /communes/:id/demarrage — chaque étape se coche d'elle-même dès qu'elle est faite.
app.get('/communes/:id/demarrage', async (c) => {
  const id = c.req.param('id');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'id,forfait,formule,logo_url,horaires_ouverture,telephone_mairie', id: `eq.${id}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  const parCommune = { commune_id: `eq.${id}` };

  const [connexions, dechets, actualites, evenements, habitants, signalements] = await Promise.all([
    supabaseSelect(c.env, 'users', {
      select: 'id', ...parCommune, role: 'in.(admin,elu,maire)', derniere_connexion_streak: 'not.is.null', limit: '1',
    }),
    supabaseCount(c.env, 'dechets_config', parCommune),
    supabaseCount(c.env, 'articles', { ...parCommune, or: '(section.is.null,section.eq.actualites)' }),
    supabaseCount(c.env, 'events', parCommune),
    supabaseCount(c.env, 'users', {
      ...parCommune, role: 'eq.citoyen', compte_provisionne: 'not.is.true', compte_supprime_le: 'is.null', compte_visiteur_demo: 'not.is.true',
    }),
    supabaseCount(c.env, 'alertes', { ...parCommune, statut: 'eq.resolue' }),
  ]);

  const etapes: { cle: string; groupe: 'mairie' | 'administratif'; libelle: string; fait: boolean; detail?: string }[] = [
    { cle: 'connexion', groupe: 'mairie', libelle: 'Quelqu’un à la mairie s’est connecté', fait: connexions.length > 0 },
    { cle: 'logo', groupe: 'mairie', libelle: 'Logo de la commune ajouté', fait: !!commune.logo_url },
    { cle: 'infos', groupe: 'mairie', libelle: 'Horaires et téléphone de la mairie renseignés', fait: !!(commune.horaires_ouverture && commune.telephone_mairie) },
    { cle: 'dechets', groupe: 'mairie', libelle: 'Calendrier des déchets configuré', fait: dechets > 0 },
    { cle: 'actualite', groupe: 'mairie', libelle: 'Première actualité publiée', fait: actualites > 0, detail: actualites ? `${actualites} publiée(s)` : undefined },
    { cle: 'evenement', groupe: 'mairie', libelle: 'Premier événement à l’agenda', fait: evenements > 0, detail: evenements ? `${evenements} au total` : undefined },
    { cle: 'habitants', groupe: 'mairie', libelle: '10 habitants inscrits', fait: habitants >= 10, detail: `${habitants} inscrit(s)` },
    { cle: 'signalement', groupe: 'mairie', libelle: 'Premier signalement traité', fait: signalements > 0 },
  ];

  if (commune.forfait && commune.forfait !== 'Gratuit') {
    const [conventions, dpa, factures] = await Promise.all([
      supabaseSelect(c.env, 'conventions', { select: 'statut', ...parCommune, statut: 'neq.annulee' }),
      infosContratDpa(c.env, id),
      supabaseCount(c.env, 'factures', parCommune),
    ]);
    const manquantsDpa = dpa ? dpa.champs.filter((ch: any) => !ch.valeur).length : 0;
    etapes.push({ cle: 'formule', groupe: 'administratif', libelle: 'Formule enregistrée (active modération et bilan)', fait: !!commune.formule, detail: commune.formule || undefined });
    if (commune.forfait === 'Fondateur') {
      etapes.push({ cle: 'convention', groupe: 'administratif', libelle: 'Convention signée', fait: conventions.some((cv: any) => cv.statut === 'signee'), detail: conventions[0]?.statut });
    }
    etapes.push({ cle: 'dpa', groupe: 'administratif', libelle: 'Contrat DPA complet', fait: manquantsDpa === 0, detail: manquantsDpa ? `${manquantsDpa} information(s) manquante(s)` : undefined });
    etapes.push({ cle: 'facture', groupe: 'administratif', libelle: 'Première facture émise', fait: factures > 0 });
  }

  return c.json({ etapes, faites: etapes.filter((e) => e.fait).length, total: etapes.length });
});

export default app;

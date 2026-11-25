// worker/src/backoffice/prospection.ts
// Phase 2 du backoffice : prospection commerciale des communes françaises à partir de l'open
// data officiel (aucune clé, aucun navigateur headless) :
//  - geo.api.gouv.fr        → liste des communes d'un département (nom, INSEE, CP, population)
//  - api-lannuaire (service-public) → contact mairie (email, téléphone, adresse, site)
// Toutes les routes sont derrière backofficeMiddleware (périmètre staff transverse).
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseSelectTout, supabaseInsert, supabaseUpdate, supabaseUpsert, supabaseCount } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { envoyerPresentation, construirePresentation, contextePresentation, genererMotDePasseTemporaire, envoyerModeleGenerique, MODELE_ONBOARDING_RELANCE_J3_DEFAUT } from './email-commune';
import { chargerOngletsGratuits, appliquerOngletsSurCommune } from './administration';
import { destinataireCommune } from './onboarding-drip';
import { synchroniserEmailsRecus } from './emails-recus';
import { hasherMotDePasse } from '../lib/password';
import { versCsv } from '../lib/csv';
import { envoyerEmail, copieEnvois } from '../lib/email';
import { envoyerEmailSuivi, adresseDesinscrite, avecPiedDesinscription } from '../lib/desinscription';
import { construireEml } from '../lib/eml';
import { fabriquerPdfDocuments, documentDisponible, DOCUMENTS_PDF, ErreurPdf } from './documents-pdf';
import { distanceMetres } from '../lib/geo';
import { chargerBareme, calculerPrixAutonomie, calculerPrixAccompagne, calculerPrixFondateur, estSurDevis } from './tarification';
import {
  type HorairesMairie, parserPlagesOuverture, etatOuverture, resumerHoraires, prochaineOuverture,
  prochainJourOuvre, ajouterJours, maintenantParis, formaterDateCourte, formaterHeure,
} from '../lib/horaires-mairie';

const app = new Hono();

// Prospection par téléphone (2026-11-19) : « l'élu d'à côté » d'abord — la file d'appels du
// tableau « Aujourd'hui » est triée par distance depuis Eaucourt-sur-Somme (centre de la commune,
// INSEE 80262, d'après geo.api.gouv.fr).
const POINT_DEPART_APPELS = { lat: 50.0708, lng: 1.8848 };
// Les mairies changent parfois d'horaires : on revérifie l'annuaire au-delà de ce délai.
const VALIDITE_HORAIRES_MS = 180 * 24 * 3600 * 1000;
const HEURE_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
app.use('*', backofficeMiddleware);

// ne_plus_contacter (2026-09-08) : distinct de "perdu" — un refus explicite de type "ne nous
// recontactez jamais" (par opposition à "pas maintenant", qui reste sur le pipeline perdu et sa
// relance à +10 mois). Jamais de relance programmée pour ce statut, jamais d'email automatique
// — voir prospecterUn/relancerCommuneActivee plus bas, tous deux gardés contre les trois statuts
// terminaux (gagne/perdu/ne_plus_contacter).
const STATUTS = ['a_contacter', 'contacte', 'relance', 'rdv', 'gagne', 'perdu', 'ne_plus_contacter'] as const;
const TYPES_INTERACTION = ['note', 'appel', 'email', 'courrier', 'rdv', 'ferme'] as const;

// — Import depuis geo.api.gouv.fr —
const importSchema = z.object({
  departement: z.string().regex(/^(\d{2,3}|2[ab])$/i),  // 01-976, Corse 2A/2B
  population_max: z.number().int().positive().optional(),
});

app.post('/importer', async (c) => {
  const body = importSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const { departement, population_max } = body.data;
  const dep = departement.toUpperCase();

  const url = `https://geo.api.gouv.fr/departements/${dep}/communes?fields=nom,code,codesPostaux,population&format=json`;
  const res = await fetch(url);
  if (!res.ok) return c.json({ erreur: `Département introuvable ou source indisponible (${res.status})` }, 502);
  const communes: any[] = await res.json();

  const retenues = communes.filter((cm) => population_max == null || (cm.population ?? 0) <= population_max);

  // On n'insère que les code_insee absents : jamais d'écrasement d'un prospect déjà travaillé
  // (statut, notes, relances conservés).
  const existants = await supabaseSelect(c.env, 'prospects', {
    select: 'code_insee', departement: `eq.${dep}`,
  });
  const dejaPresents = new Set(existants.map((p: any) => p.code_insee));

  const nouveaux = retenues
    .filter((cm) => cm.code && !dejaPresents.has(cm.code))
    .map((cm) => ({
      code_insee: cm.code,
      nom: cm.nom,
      code_postal: Array.isArray(cm.codesPostaux) ? cm.codesPostaux[0] ?? null : null,
      departement: dep,
      population: cm.population ?? null,
    }));

  if (nouveaux.length > 0) await supabaseInsert(c.env, 'prospects', nouveaux);

  return c.json({ ok: true, importes: nouveaux.length, deja_presents: retenues.length - nouveaux.length });
});

// — Synchronisation du nom des maires depuis le Répertoire National des Élus (RNE, ministère de
//   l'Intérieur, data.gouv.fr) —
// URL vérifiée le 2026-08-24 : fichier "Maires" du RNE, mis à jour tous les ~14 jours par le
// ministère. Contrairement à enrichirDepuisAnnuaire ci-dessus (une vraie API interrogeable par
// commune), ce fichier est un export CSV national unique (~35 000 lignes, ~4 Mo) : on le
// télécharge et on l'indexe une fois par appel plutôt que de faire un aller-retour par prospect.
const URL_RNE_MAIRES = 'https://www.data.gouv.fr/api/1/datasets/r/2876a346-d50c-4911-934e-19ee07b0e503';

// "EVALET TAPONAT" + "Line" → "Line Evalet Taponat" — le nom de famille arrive en capitales dans
// le RNE, on le remet en casse normale pour un rendu correct dans l'email et le backoffice.
function formaterNomMaire(nom: string, prenom: string): string {
  const nomForme = nom.trim().toLowerCase().replace(/(^|[\s-])\p{L}/gu, (l) => l.toUpperCase());
  return `${prenom.trim()} ${nomForme}`.trim();
}

app.post('/synchroniser-maires', async (c) => {
  const t0 = Date.now();
  const chrono = () => `${Date.now() - t0}ms`;

  let existants: any[];
  try {
    // nom + departement (NOT NULL sans defaut) récupérés en même temps que code_insee : voir le
    // commentaire de supabaseUpsert dans db.ts, ils doivent accompagner CHAQUE ligne du payload
    // même quand seule nom_maire/maire_civilite change réellement.
    existants = await supabaseSelectTout(c.env, 'prospects', { select: 'id,code_insee,nom,departement,commune_id' });
  } catch (err: any) {
    console.error('synchroniser-maires — lecture prospects échouée :', err);
    return c.json({ erreur: `Lecture des prospects impossible (${chrono()}) : ${err?.message || err}` }, 500);
  }
  if (!existants.length) return c.json({ ok: true, mis_a_jour: 0, total_prospects: 0 });
  const prospectParCodeInsee = new Map(existants.map((p: any) => [p.code_insee, p]));

  let texte: string;
  try {
    const res = await fetch(URL_RNE_MAIRES);
    if (!res.ok) return c.json({ erreur: `Source RNE indisponible (${res.status}, ${chrono()})` }, 502);
    texte = await res.text();
  } catch (err: any) {
    console.error('synchroniser-maires — téléchargement RNE échoué :', err);
    return c.json({ erreur: `Téléchargement du fichier RNE impossible (${chrono()}) : ${err?.message || err}` }, 502);
  }

  // Fichier RNE spécifiquement : pas de champ entre guillemets (vérifié sur un extrait réel), donc
  // un simple split natif suffit et est bien plus rapide qu'un parseur caractère par caractère sur
  // ~35 000 lignes/4 Mo — important le temps CPU d'une invocation Worker est limité. depuisCsv
  // (lib/csv.ts) reste le parseur à utiliser pour un fichier dont on n'est pas sûr du contenu.
  let entete: string[], lignesTexte: string[];
  try {
    lignesTexte = texte.split(/\r?\n/);
    entete = (lignesTexte[0] || '').split(';');
  } catch (err: any) {
    console.error('synchroniser-maires — parsing du CSV RNE échoué :', err);
    return c.json({ erreur: `Lecture du fichier RNE impossible (${chrono()}) : ${err?.message || err}` }, 502);
  }

  const iCode = entete.indexOf('Code de la commune');
  const iNom = entete.indexOf('Nom de l\'élu');
  const iPrenom = entete.indexOf('Prénom de l\'élu');
  const iSexe = entete.indexOf('Code sexe');
  if (iCode < 0 || iNom < 0 || iPrenom < 0) {
    console.error('synchroniser-maires — colonnes introuvables, en-tête reçu :', entete);
    return c.json({ erreur: `Format du fichier RNE inattendu, colonnes introuvables (${chrono()}).` }, 502);
  }

  // On ne touche qu'aux prospects déjà importés (jamais d'insertion de nouveaux prospects ici :
  // ce n'est pas le rôle de cette route, voir /importer plus haut) — le on_conflict de l'upsert
  // ne fait donc en pratique que mettre à jour, jamais créer de ligne. nom/departement repartent
  // inchangés dans le payload : voir le commentaire de supabaseUpsert (db.ts) pour pourquoi c'est
  // nécessaire malgré le fait qu'on ne veuille modifier QUE nom_maire/maire_civilite.
  const maj: { code_insee: string; nom: string; departement: string; nom_maire: string; prenom_maire: string; maire_civilite: string | null }[] = [];
  for (let i = 1; i < lignesTexte.length; i++) {
    if (!lignesTexte[i]) continue;
    const ligne = lignesTexte[i].split(';');
    const codeInsee = ligne[iCode];
    const prospect = codeInsee ? prospectParCodeInsee.get(codeInsee) : undefined;
    if (!prospect) continue;
    const nom = ligne[iNom], prenom = ligne[iPrenom];
    if (!nom || !prenom) continue;
    const sexe = iSexe >= 0 ? ligne[iSexe] : '';
    maj.push({
      code_insee: codeInsee,
      nom: prospect.nom,
      departement: prospect.departement,
      nom_maire: formaterNomMaire(nom, prenom),
      prenom_maire: prenom.trim(),
      maire_civilite: sexe === 'F' ? 'Madame' : sexe === 'M' ? 'Monsieur' : null,
    });
  }

  // Par lots : le RNE couvre la quasi-totalité des communes françaises, donc maj peut avoisiner
  // le nombre total de prospects déjà importés (15 000+) — un upsert en un seul appel envoie tout
  // ça comme un unique INSERT ... ON CONFLICT DO UPDATE côté Postgres, qui finit par dépasser le
  // statement_timeout (500/503 constatés le 2026-09-08, avec un 503 collatéral sur /apercu juste
  // après — la connexion restée ouverte trop longtemps a probablement saturé le pool Supabase).
  // 500 lignes par lot : aucun précédent exact dans ce fichier pour un upsert à cette échelle
  // (TAILLE_LOT_MAIRES = 100 juste plus bas répond à un problème différent, la longueur d'URL
  // d'un in.(), pas la durée d'un upsert) — valeur prudente à ajuster si ça recasse.
  const TAILLE_LOT_MAJ_PROSPECTS = 500;
  if (maj.length) {
    try {
      for (let i = 0; i < maj.length; i += TAILLE_LOT_MAJ_PROSPECTS) {
        await supabaseUpsert(c.env, 'prospects', maj.slice(i, i + TAILLE_LOT_MAJ_PROSPECTS), 'code_insee');
      }
    } catch (err: any) {
      console.error('synchroniser-maires — écriture en base échouée :', err);
      return c.json({ erreur: `Écriture en base impossible (${chrono()}, ${maj.length} ligne(s)) : ${err?.message || err}` }, 500);
    }
  }

  return c.json({ ok: true, mis_a_jour: maj.length, total_prospects: existants.length });
});

// — Liste (filtres sobres : statut, département, recherche) —
const TRIS: Record<string, string> = {
  nom: 'nom.asc',
  departement: 'departement.asc,nom.asc',
  population_desc: 'population.desc.nullslast',
  population_asc: 'population.asc.nullslast',
};

const TAILLE_PAGE_PROSPECTS = 100;

// Communes dont le compte mairie (secrétariat ou maire — voir activerCommuneGratuite, rôle
// 'admin' depuis le 2026-10-06, 'maire' pour les comptes créés avant cette date) s'est réellement
// connecté au moins une fois — le signal le plus fiable de tous, voir /stats-variantes. Pas
// 'citoyen' : on exclut volontairement les comptes citoyens, ce signal porte sur le contact
// administratif, pas sur la fréquentation générale de l'app (couverte par ailleurs).
// Résilient (table users toujours présente, mais on protège quand même comme pour communesInscrites).
async function chargerCommunesConnectees(env: any): Promise<Set<string>> {
  const comptes = await supabaseSelectTout(env, 'users', {
    select: 'commune_id,derniere_connexion_streak', role: 'in.(admin,elu,maire,superadmin)',
  }).catch(() => []);
  return new Set(comptes.filter((m: any) => m.derniere_connexion_streak).map((m: any) => m.commune_id));
}

app.get('/prospects', async (c) => {
  // Filtres communs à la liste ET au comptage total (pagination).
  const where: Record<string, string> = {};
  const statut = c.req.query('statut');
  const departement = c.req.query('departement');
  const recherche = c.req.query('recherche');
  if (statut && STATUTS.includes(statut as any)) where.statut = `eq.${statut}`;
  if (departement) where.departement = `eq.${departement.toUpperCase()}`;
  if (recherche) where.nom = `ilike.*${recherche}*`;

  // Signal "🔥 s'est inscrit" : au moins un citoyen a créé lui-même son compte dans la commune
  // activée pour ce prospect — bien plus fort qu'un simple envoi d'email (voir onboarding.ts →
  // declencherBienvenuePremiereInscription). Calculé à part (pas de embedding PostgREST) pour
  // rester simple ; ?inscrits=1 filtre la liste sur ce seul signal.
  // Résilient : si la migration 044 (colonne premiere_inscription_citoyen_le) n'est pas encore
  // passée, la liste doit quand même se charger (signal simplement absent) plutôt que 500.
  const communesInscrites = await supabaseSelectTout(c.env, 'communes', {
    select: 'id', premiere_inscription_citoyen_le: 'not.is.null',
  }).catch(() => []);
  const idsCommunesInscrites = new Set(communesInscrites.map((cm: any) => cm.id));

  // Signal "🔑 quelqu'un côté mairie s'est connecté" : le plus fiable de tous, plus fort qu'une
  // simple ouverture d'email. ?maire_connecte=1 filtre la liste dessus (nom de paramètre conservé
  // pour ne pas casser le frontend, même si ce n'est plus forcément littéralement le maire).
  const idsCommunesConnectees = await chargerCommunesConnectees(c.env);

  let idsFiltreCommune: Set<string> | null = null;
  if (c.req.query('inscrits') === '1') idsFiltreCommune = idsCommunesInscrites;
  if (c.req.query('maire_connecte') === '1') {
    idsFiltreCommune = idsFiltreCommune
      ? new Set([...idsFiltreCommune].filter((id) => idsCommunesConnectees.has(id)))
      : idsCommunesConnectees;
  }

  const tri = c.req.query('tri');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const offset = (page - 1) * TAILLE_PAGE_PROSPECTS;
  const selectProspects = 'id,code_insee,nom,departement,population,statut,contact_email,email_invalide,prochaine_relance_le,commune_id,nom_maire';
  const order = (tri && TRIS[tri]) || TRIS.nom;

  let prospects: any[];
  let total: number;
  if (idsFiltreCommune) {
    // ⚠️ NE JAMAIS construire un filtre commune_id: in.(...) à partir de ce Set — à l'échelle
    // de la prospection (des milliers de communes activées), l'URL PostgREST résultante dépasse
    // toute limite raisonnable et échoue silencieusement en 500 (bug vécu le 2026-09-01, page
    // Prospection entière en erreur). Comme ces deux signaux ("inscrit"/"maire connecté") ne
    // vivent pas sur la table prospects elle-même, on filtre en mémoire après un chargement
    // paginé classique (supabaseSelectTout — sans in.(), tient à n'importe quelle échelle,
    // voir calculerStatsVariantes plus bas pour le même principe).
    const tousLesProspectsFiltres = idsFiltreCommune.size
      ? await supabaseSelectTout(c.env, 'prospects', { ...where, select: selectProspects, order })
      : [];
    const filtres = tousLesProspectsFiltres.filter((p: any) => p.commune_id && idsFiltreCommune!.has(p.commune_id));
    total = filtres.length;
    prospects = filtres.slice(offset, offset + TAILLE_PAGE_PROSPECTS);
  } else {
    [prospects, total] = await Promise.all([
      supabaseSelect(c.env, 'prospects', {
        ...where,
        select: selectProspects,
        order,
        limit: String(TAILLE_PAGE_PROSPECTS),
        offset: String(offset),
      }),
      supabaseCount(c.env, 'prospects', where),
    ]);
  }

  const prospectsAvecSignal = prospects.map((p: any) => ({
    ...p,
    inscrit: !!(p.commune_id && idsCommunesInscrites.has(p.commune_id)),
    maire_connecte: !!(p.commune_id && idsCommunesConnectees.has(p.commune_id)),
  }));

  return c.json({
    prospects: prospectsAvecSignal, page, taille: TAILLE_PAGE_PROSPECTS, total,
    total_inscrits: idsCommunesInscrites.size,
    total_maires_connectes: idsCommunesConnectees.size,
  });
});

// GET /prospects-export.csv — mêmes filtres que la liste (statut/departement/recherche), mais
// sans pagination : tout ce qui correspond, pour sauvegarde/analyse externe.
// rattrapage=1 : ignore les autres filtres et applique exactement le critère de
// « candidats-rattrapage » ci-dessous (contacté/relancé/rdv sans commune activée), pour
// obtenir la liste nominative (avec email) de ce que le compteur "contactes_sans_commune" compte.
app.get('/prospects-export.csv', async (c) => {
  const where: Record<string, string> = {};
  if (c.req.query('rattrapage') === '1') {
    where.commune_id = 'is.null';
    where.statut = 'in.(contacte,relance,rdv)';
  } else {
    const statut = c.req.query('statut');
    const departement = c.req.query('departement');
    const recherche = c.req.query('recherche');
    if (statut && STATUTS.includes(statut as any)) where.statut = `eq.${statut}`;
    if (departement) where.departement = `eq.${departement.toUpperCase()}`;
    if (recherche) where.nom = `ilike.*${recherche}*`;
  }

  // Export = tout ce qui correspond, donc pagination complète (même piège que /apercu : un
  // simple limit élevé ne suffit pas, Supabase plafonne à 1000 lignes par réponse).
  let prospects = await supabaseSelectTout(c.env, 'prospects', {
    ...where,
    select: 'nom,departement,population,statut,nom_maire,contact_email,contact_telephone,site_web,prochaine_relance_le,created_at,commune_id',
    order: 'nom.asc',
  });
  // ⚠️ Même piège que GET /prospects ci-dessus : jamais de commune_id: in.(...) construit à
  // partir d'un Set qui peut contenir des milliers d'ids (URL PostgREST trop longue → 500).
  // Filtré en mémoire après coup à la place.
  if (c.req.query('maire_connecte') === '1') {
    const idsCommunesConnectees = await chargerCommunesConnectees(c.env);
    prospects = prospects.filter((p: any) => p.commune_id && idsCommunesConnectees.has(p.commune_id));
  }
  const csv = versCsv(prospects, [
    { cle: 'nom', titre: 'Commune' }, { cle: 'departement', titre: 'Département' },
    { cle: 'population', titre: 'Population' }, { cle: 'statut', titre: 'Statut' },
    { cle: 'nom_maire', titre: 'Maire' },
    { cle: 'contact_email', titre: 'Email' }, { cle: 'contact_telephone', titre: 'Téléphone' },
    { cle: 'site_web', titre: 'Site web' }, { cle: 'prochaine_relance_le', titre: 'Prochaine relance' },
    { cle: 'created_at', titre: 'Ajouté le' },
  ]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="prospects-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// GET /prospects/candidats-rattrapage — liste légère (id + nom) des prospects déjà contactés
// AVANT la mise en place de l'activation automatique (2026-08-17), donc toujours sans commune.
// Le rattrapage lui-même se fait ENSUITE côté client, un appel à POST /prospects/:id/prospecter
// à la fois (voir frontend/backoffice/js/app.js, rattraperActivation) — délibérément PAS un
// traitement en lot côté Worker : cumuler plusieurs activations (annuaire + Supabase + Resend +
// hachage PBKDF2 par prospect) dans UNE SEULE invocation s'est révélé intermittent (limite de
// temps/CPU cumulée, non rattrapable par un simple try/catch côté code). Un appel par prospect
// hérite de la fiabilité déjà éprouvée du bouton d'envoi unitaire.
// IMPORTANT : doit rester déclarée AVANT GET /prospects/:id ci-dessous, sinon Hono matche
// « candidats-rattrapage » comme un :id et la requête échoue (bug déjà rencontré le 2026-08-17).
app.get('/prospects/candidats-rattrapage', async (c) => {
  const candidats = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom', commune_id: 'is.null', statut: 'in.(contacte,relance,rdv)', order: 'nom.asc', limit: '500',
  });
  return c.json({ candidats });
});

// — Carte : uniquement les prospects géolocalisés (lat renseignée). Se remplit au fil de
//   l'enrichissement. Filtre département optionnel. —
app.get('/carte', async (c) => {
  const filtres: Record<string, string> = {
    select: 'id,nom,statut,lat,lng,departement',
    lat: 'not.is.null',
  };
  const departement = c.req.query('departement');
  if (departement) filtres.departement = `eq.${departement.toUpperCase()}`;
  const prospects = await supabaseSelect(c.env, 'prospects', filtres);
  return c.json({ prospects });
});

// — Boîte de réception des réponses reçues (voir emails-recus.ts, alimentée par le webhook
// Resend Receiving). Triée par mots-clés côté serveur, aucune IA : à traiter à la main. —
const CATEGORIES_EMAILS_RECUS = ['verification_antispam', 'fermeture', 'changement_email', 'autre'] as const;

// POST /emails-recus/synchroniser — bouton "🔄 Synchroniser avec Resend" : comble les trous en
// repartant de la liste faisant autorité de Resend, voir synchroniserEmailsRecus (emails-recus.ts)
// pour le pourquoi (webhook non déclenché pour certains messages, ex. réponses d'absence).
app.post('/emails-recus/synchroniser', async (c) => {
  const r = await synchroniserEmailsRecus(c.env);
  return c.json({ ok: true, ...r });
});

app.get('/emails-recus', async (c) => {
  const where: Record<string, string> = {};
  const traite = c.req.query('traite');
  if (traite === '0') where.traite_le = 'is.null';
  if (traite === '1') where.traite_le = 'not.is.null';
  const categorie = c.req.query('categorie');
  if (categorie && (CATEGORIES_EMAILS_RECUS as readonly string[]).includes(categorie)) where.categorie = `eq.${categorie}`;

  const [emails, aTraiter] = await Promise.all([
    supabaseSelect(c.env, 'emails_recus', {
      ...where,
      select: 'id,prospect_id,commune_nom,expediteur,sujet,texte,categorie,traite_le,created_at',
      order: 'created_at.desc', limit: '200',
    }),
    supabaseCount(c.env, 'emails_recus', { traite_le: 'is.null' }),
  ]);
  return c.json({ emails, a_traiter: aTraiter });
});

const patchEmailRecuSchema = z.object({ traite: z.boolean() });

app.patch('/emails-recus/:id', async (c) => {
  const id = c.req.param('id');
  const body = patchEmailRecuSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  await supabaseUpdate(c.env, 'emails_recus', {
    traite_le: body.data.traite ? new Date().toISOString() : null,
  }, { id: `eq.${id}` });
  return c.json({ ok: true });
});

// POST /emails-recus/:id/repondre — répondre à une réponse reçue SANS quitter le backoffice.
// Threadée (En-têtes In-Reply-To/References sur le message_id d'origine) : côté client mail du
// destinataire, ça s'affiche comme une réponse normale dans la même conversation, pas comme un
// email tout neuf. Le reply_to reste l'adresse de réception dédiée, pour que la conversation
// continue d'alimenter cette même boîte si la mairie répond encore. Marque automatiquement
// traite_le : répondre EST l'action de traitement, pas la peine de cocher en plus à la main.
const repondreEmailRecuSchema = z.object({ message: z.string().min(1).max(5000) });

app.post('/emails-recus/:id/repondre', async (c) => {
  const id = c.req.param('id');
  const body = repondreEmailRecuSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [email] = await supabaseSelect(c.env, 'emails_recus', {
    select: 'id,expediteur,sujet,message_id_original,prospect_id', id: `eq.${id}`,
  });
  if (!email) return c.json({ erreur: 'Message introuvable' }, 404);

  const objet = email.sujet ? `Re: ${email.sujet}` : 'Re: votre message';
  const corps = construireEmailLibre(body.data.message);
  const enTetes = email.message_id_original
    ? { 'In-Reply-To': email.message_id_original, References: email.message_id_original }
    : undefined;

  const resendEmailId = await envoyerEmail(
    c.env, email.expediteur, objet, corps, undefined, c.env.EMAIL_REPLY_TO_PROSPECTION, enTetes, copieEnvois(c.env),
  );
  if (!resendEmailId) return c.json({ erreur: 'Échec de l\'envoi (voir logs Worker)' }, 502);

  await supabaseUpdate(c.env, 'emails_recus', { traite_le: new Date().toISOString() }, { id: `eq.${id}` });

  if (email.prospect_id) {
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id: email.prospect_id, staff_id: c.get('staff_id'),
      type: 'email', contenu: `Réponse envoyée à ${email.expediteur} depuis la boîte de réception`,
    });
  }

  return c.json({ ok: true });
});

// — Aperçu : compteurs par statut + relances dues aujourd'hui —
app.get('/apercu', async (c) => {
  // Pagination complète (pas un simple limit élevé) : Supabase plafonne chaque réponse à 1000
  // lignes quel que soit le `limit` demandé, donc la répartition par statut sous-comptait
  // silencieusement dès que la table dépassait 1000 prospects (piège découvert le 2026-08-18,
  // même cause que /administration/apercu — voir supabaseSelectTout dans db.ts).
  const prospects = await supabaseSelectTout(c.env, 'prospects', {
    select: 'statut,prochaine_relance_le,commune_id',
  });
  const parStatut: Record<string, number> = {};
  for (const s of STATUTS) parStatut[s] = 0;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  let a_relancer = 0;
  // Distinct de a_relancer ci-dessus : un refus ("perdu") suit un rythme de relance long
  // (+10 mois par défaut, voir MOIS_RELANCE_APRES_REFUS) — jamais mélangé au rappel actif, pour
  // ne pas donner l'impression qu'il faut le retraiter tout de suite comme un prospect chaud.
  let perdus_a_relancer = 0;
  // Contactés (au sens large : ont reçu au moins une présentation) mais toujours sans commune
  // réelle — ce que traite « Activer et renvoyer ». Distingué de ceux déjà activés, pour
  // vérifier précisément l'avancement du rattrapage plutôt que de se fier à un seul message.
  let contactes_sans_commune = 0;
  let contactes_avec_commune = 0;
  const STATUTS_CONTACTES = ['contacte', 'relance', 'rdv'];
  for (const p of prospects) {
    parStatut[p.statut] = (parStatut[p.statut] ?? 0) + 1;
    if (p.prochaine_relance_le && p.prochaine_relance_le <= aujourdhui &&
        p.statut !== 'gagne' && p.statut !== 'perdu' && p.statut !== 'ne_plus_contacter') a_relancer += 1;
    if (p.statut === 'perdu' && p.prochaine_relance_le && p.prochaine_relance_le <= aujourdhui) perdus_a_relancer += 1;
    if (STATUTS_CONTACTES.includes(p.statut)) {
      if (p.commune_id) contactes_avec_commune += 1;
      else contactes_sans_commune += 1;
    }
  }
  return c.json({
    total: prospects.length, par_statut: parStatut, a_relancer, perdus_a_relancer,
    contactes_sans_commune, contactes_avec_commune,
  });
});

// GET /prospects-a-relancer — liste (pas juste le compte de /apercu ci-dessus) des prospects dus
// aujourd'hui ou en retard, pour le tableau de bord "Aujourd'hui" (voir administration.ts pour
// les autres briques : échéances, onboarding bloqué, emails rejetés). Un filtre `lte` sur une
// colonne nullable exclut naturellement les NULL (NULL <= X est indéterminé en SQL), donc pas
// besoin d'un `not.is.null` séparé sur prochaine_relance_le.
app.get('/prospects-a-relancer', async (c) => {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,departement,statut,prochaine_relance_le',
    prochaine_relance_le: `lte.${aujourdhui}`,
    statut: 'in.(a_contacter,contacte,relance,rdv)',
    order: 'prochaine_relance_le.asc',
    limit: '200',
  });
  return c.json({ prospects, aujourdhui });
});

// GET /appels-du-jour?rayon_km=30 — file d'appels du tableau « Aujourd'hui » (2026-11-19).
// Volontairement limitée aux communes proches d'Eaucourt (« l'élu d'à côté », choix de Léandre) :
// l'arriéré national de relances laissé par les envois d'août (~13 800 dates dépassées) ne doit
// pas noyer la liste. Relance due OU jamais programmée (communes voisines jamais démarchées).
// Filtre en deux temps : carré autour d'Eaucourt côté base (index lat/lng inutile à cette
// échelle), puis vrai cercle en mémoire.
const RAYON_APPELS_DEFAUT_KM = 30;
app.get('/appels-du-jour', async (c) => {
  const rayon = Math.min(300, Math.max(5, parseInt(c.req.query('rayon_km') || '', 10) || RAYON_APPELS_DEFAUT_KM));
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const { lat, lng } = POINT_DEPART_APPELS;
  const dLat = rayon / 111.32;
  const dLng = rayon / (111.32 * Math.cos((lat * Math.PI) / 180));
  const [prospects, communesConnectees] = await Promise.all([
    supabaseSelect(c.env, 'prospects', {
      select: 'id,code_insee,nom,statut,prochaine_relance_le,prochaine_relance_heure,contact_telephone,horaires_ouverture,horaires_verifies_le,lat,lng,commune_id',
      statut: 'in.(a_contacter,contacte,relance,rdv)',
      or: `(prochaine_relance_le.lte.${aujourdhui},prochaine_relance_le.is.null)`,
      and: `(lat.gte.${(lat - dLat).toFixed(4)},lat.lte.${(lat + dLat).toFixed(4)},lng.gte.${(lng - dLng).toFixed(4)},lng.lte.${(lng + dLng).toFixed(4)})`,
      limit: '1000',
    }),
    chargerCommunesConnectees(c.env),
  ]);
  const proches = prospects
    .map((p: any) => ({ ...p, distance: distanceMetres(lat, lng, p.lat, p.lng) / 1000 }))
    .filter((p: any) => p.distance <= rayon)
    .sort((a: any, b: any) => a.distance - b.distance);
  await completerHoraires(c.env, proches); // les plus proches d'abord (plafond par appel)
  const maintenant = new Date();
  const appels = proches.map((p: any) => ({
    id: p.id, nom: p.nom, statut: p.statut,
    prochaine_relance_le: p.prochaine_relance_le,
    prochaine_relance_heure: p.prochaine_relance_heure?.slice(0, 5) ?? null,
    contact_telephone: p.contact_telephone,
    ouverture: etatOuverture(p.horaires_ouverture, maintenant),
    maire_connecte: !!(p.commune_id && communesConnectees.has(p.commune_id)),
    distance_km: Math.round(p.distance),
  })).sort(trierFileAppels);
  return c.json({ appels, rayon_km: rayon, aujourdhui });
});

// Ordre de la file d'appels : joignable (téléphone connu) → mairie ouverte maintenant → 🔑
// quelqu'un s'est déjà connecté → la plus proche d'Eaucourt → la relance la plus ancienne.
export function trierFileAppels(a: any, b: any): number {
  return (Number(!!b.contact_telephone) - Number(!!a.contact_telephone))
    || (Number(!!b.ouverture?.ouvert) - Number(!!a.ouverture?.ouvert))
    || (Number(b.maire_connecte) - Number(a.maire_connecte))
    || ((a.distance_km ?? Infinity) - (b.distance_km ?? Infinity))
    || String(a.prochaine_relance_le).localeCompare(String(b.prochaine_relance_le));
}

// GET /prospects-perdus — pipeline de relance des refus ("tièdes"), demandé par Léandre le
// 2026-09-03 : un prospect passé en "Perdu" ne doit pas sortir purement et simplement du radar,
// juste basculer sur un rythme de relance long (voir MOIS_RELANCE_APRES_REFUS ci-dessous, posé
// automatiquement par PATCH /prospects/:id). Tableau dédié dans la vue Prospection : nom, date
// du refus, raison, prochaine relance — nullslast pour remonter les refus déjà datés d'abord et
// laisser en bas les quelques prospects marqués perdus avant l'existence de ce suivi (perdu_le
// et prochaine_relance_le vides pour ceux-là, faute de backfill).
// supabaseSelectTout (pas un simple `limit`) : même piège que /apercu et /prospects-a-relancer —
// un plafond fixe tronquerait silencieusement ce tableau une fois plusieurs centaines de refus
// accumulés, exactement le genre de bug déjà corrigé ailleurs dans ce fichier cette semaine.
app.get('/prospects-perdus', async (c) => {
  const prospects = await supabaseSelectTout(c.env, 'prospects', {
    select: 'id,nom,departement,perdu_le,raison_perdu,prochaine_relance_le',
    statut: 'eq.perdu',
    order: 'prochaine_relance_le.asc.nullslast',
  });
  return c.json({ prospects });
});

// GET /prospects-perdus-a-relancer — sous-ensemble de la liste ci-dessus dû aujourd'hui ou en
// retard, pour le rappel dans le tableau de bord "Aujourd'hui" (voir chargerAujourdhui côté
// frontend). Volontairement PAS mélangé à /prospects-a-relancer ni à relancer-lot : un refus se
// retravaille à la main, personnalisé — jamais par un email en lot comme les prospects chauds.
app.get('/prospects-perdus-a-relancer', async (c) => {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,departement,raison_perdu,prochaine_relance_le',
    statut: 'eq.perdu',
    prochaine_relance_le: `lte.${aujourdhui}`,
    order: 'prochaine_relance_le.asc',
    limit: '200',
  });
  return c.json({ prospects, aujourdhui });
});

// — Fiche + timeline —
app.get('/prospects/:id', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,code_insee,nom,code_postal,departement,population,statut,contact_email,contact_telephone,site_web,adresse,notes,prochaine_relance_le,prochaine_relance_heure,enrichi_le,commune_id,created_at,nom_maire,prenom_maire,maire_civilite,etoiles,perdu_le,raison_perdu,horaires_ouverture,horaires_verifies_le,qualification,lat,lng',
    id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);
  // Horaires d'ouverture : récupérés à la première ouverture de la fiche (prospects enrichis
  // avant le 2026-11-19), puis revérifiés tous les 6 mois — voir completerHoraires.
  const [, tarif] = await Promise.all([completerHoraires(c.env, [prospect]), tarifProspect(c.env, prospect.population)]);
  prospect.prochaine_relance_heure = prospect.prochaine_relance_heure?.slice(0, 5) ?? null;
  // Mémo d'appel : « l'élu d'à côté, à 12 km de chez vous ».
  const distance_km = prospect.lat != null && prospect.lng != null
    ? Math.round(distanceMetres(POINT_DEPART_APPELS.lat, POINT_DEPART_APPELS.lng, prospect.lat, prospect.lng) / 1000)
    : null;

  // Le slug ne vit que sur communes (créée à l'activation, voir activerCommuneGratuite) : sans
  // lui, impossible de personnaliser un lien vers la fiche de présentation ou son QR pour CE
  // prospect précis — jusqu'ici seul l'écran de conversion manuelle l'avait sous la main.
  let commune_slug: string | null = null;
  let maire_connecte = false;
  if (prospect.commune_id) {
    const [commune] = await supabaseSelect(c.env, 'communes', { select: 'slug', id: `eq.${prospect.commune_id}` });
    commune_slug = commune?.slug || null;
    // Signal le plus fiable de tous (voir /stats-variantes) : quelqu'un côté mairie (secrétariat
    // ou maire) s'est-il RÉELLEMENT connecté au moins une fois à la commune activée pour ce
    // prospect. Plusieurs comptes possibles une fois une vraie conversion faite (maire + élus) :
    // le signal est positif si AU MOINS UN s'est déjà connecté.
    const comptesMairie = await supabaseSelect(c.env, 'users', {
      select: 'derniere_connexion_streak', commune_id: `eq.${prospect.commune_id}`, role: 'in.(admin,elu,maire,superadmin)',
    });
    maire_connecte = comptesMairie.some((m: any) => m.derniere_connexion_streak);
  }

  const interactions = await supabaseSelect(c.env, 'prospect_interactions', {
    select: 'type,contenu,created_at', prospect_id: `eq.${id}`, order: 'created_at.desc',
  });
  return c.json({
    prospect: {
      ...prospect, commune_slug, maire_connecte, distance_km, tarif,
      ouverture: etatOuverture(prospect.horaires_ouverture),
      horaires_resume: resumerHoraires(prospect.horaires_ouverture),
    },
    interactions,
  });
});

// Prix de CETTE commune, pour le mémo d'appel et le mail « Pour convaincre le maire » :
// toujours calculé depuis le barème en base (Réglages du backoffice), jamais un chiffre recopié
// à la main — les essais de prospection du 2026-11-18 avaient donné trois prix différents.
// null si la population est inconnue.
export async function tarifProspect(env: any, population: number | null | undefined) {
  if (!population) return null;
  const bareme = await chargerBareme(env);
  if (estSurDevis(population, bareme)) return { habitants: population, sur_devis: true as const };
  const autonomie = calculerPrixAutonomie(population, bareme);
  const accompagne = calculerPrixAccompagne(population, bareme);
  return {
    habitants: population, sur_devis: false as const, autonomie, accompagne,
    fondateur_autonomie: calculerPrixFondateur(autonomie), fondateur_accompagne: calculerPrixFondateur(accompagne),
  };
}

// — Enrichissement contact via l'annuaire (une seule commune à la fois : léger) —
export function premiereValeur(champJson: string | null | undefined): string | null {
  if (!champJson) return null;
  try {
    const arr = JSON.parse(champJson);
    return Array.isArray(arr) && arr[0]?.valeur ? arr[0].valeur : null;
  } catch { return null; }
}

export function formaterAdresse(champJson: string | null | undefined): string | null {
  if (!champJson) return null;
  try {
    const a = JSON.parse(champJson)?.[0];
    if (!a) return null;
    return [a.numero_voie, a.complement1, `${a.code_postal ?? ''} ${a.nom_commune ?? ''}`.trim()]
      .filter(Boolean).join(', ') || null;
  } catch { return null; }
}

// Coordonnées [lng, lat] depuis l'adresse annuaire (les champs y sont des chaînes). null si absent.
export function coordsDepuisAdresse(champJson: string | null | undefined): { lat: number; lng: number } | null {
  if (!champJson) return null;
  try {
    const a = JSON.parse(champJson)?.[0];
    const lat = parseFloat(a?.latitude);
    const lng = parseFloat(a?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  } catch { /* ignore */ }
  return null;
}

// Récupère le contact mairie depuis l'annuaire, met à jour le prospect et renvoie la ligne à
// jour. Renvoie null si l'annuaire n'a pas de fiche. Partagé par /enrichir, /prospecter et la
// correction automatique des emails invalides (bounces Resend, voir corrigerEmailsInvalides).
// Toute adresse CONFIRMÉE par l'annuaire (même identique à celle déjà en base) lève le flag
// email_invalide — pas seulement une adresse différente comme avant le 2026-08-31. Beaucoup de
// bounces ne sont PAS une adresse morte mais un filtrage anti-spam ponctuel côté fournisseur
// (Orange/Wanadoo notamment, ~200 bounces constatés le même jour, même message générique) : dans
// ce cas l'annuaire renvoie légitimement la MÊME adresse, et l'ancienne condition ne débloquait
// donc jamais rien pour toute cette catégorie — "Corriger via l'annuaire" semblait ne servir à
// rien alors que l'adresse était en fait correcte depuis le début.
async function enrichirDepuisAnnuaire(
  env: any,
  prospect: { id: string; code_insee: string; contact_email?: string | null; email_invalide?: boolean },
): Promise<any | null> {
  const url = `https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records`
    + `?where=${encodeURIComponent(`pivot like "mairie" and code_insee_commune="${prospect.code_insee}"`)}`
    + `&select=nom,adresse_courriel,telephone,adresse,site_internet,plage_ouverture&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const fiche = ((await res.json()) as any)?.results?.[0];
  if (!fiche) return null;

  const nouvelEmail = fiche.adresse_courriel || null;
  const coords = coordsDepuisAdresse(fiche.adresse);
  const patch: Record<string, unknown> = {
    contact_email: nouvelEmail,
    contact_telephone: premiereValeur(fiche.telephone),
    site_web: premiereValeur(fiche.site_internet),
    adresse: formaterAdresse(fiche.adresse),
    horaires_ouverture: parserPlagesOuverture(fiche.plage_ouverture),
    horaires_verifies_le: new Date().toISOString(),
    enrichi_le: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Coordonnées récupérées « gratuitement » depuis l'annuaire : alimentent la carte au fil de l'eau.
  if (coords) { patch.lat = coords.lat; patch.lng = coords.lng; }
  if (prospect.email_invalide && nouvelEmail) {
    patch.email_invalide = false;
  }
  const [maj] = await supabaseUpdate(env, 'prospects', patch, { id: `eq.${prospect.id}` });
  return maj;
}

// Horaires de plusieurs mairies en UNE requête annuaire (filtre `in`, jusqu'à 40 communes) —
// jamais une requête par commune (plafond de sous-requêtes du Worker). Les codes INSEE viennent
// de la base mais sont quand même filtrés avant d'entrer dans la clause ODSQL. Une commune
// absente de la Map = mairie sans horaires publiés (ou sans fiche). Lève en cas d'erreur réseau.
async function horairesDepuisAnnuaire(codesInsee: string[]): Promise<Map<string, HorairesMairie>> {
  const codes = [...new Set(codesInsee)].filter((code) => /^[0-9][0-9AB][0-9]{3}$/i.test(code)).slice(0, 40);
  const horaires = new Map<string, HorairesMairie>();
  if (!codes.length) return horaires;
  const where = `pivot like "mairie" and code_insee_commune in (${codes.map((code) => `"${code}"`).join(',')})`;
  const url = `https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records`
    + `?where=${encodeURIComponent(where)}&select=code_insee_commune,plage_ouverture&limit=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`annuaire ${res.status}`);
  for (const fiche of (((await res.json()) as any)?.results || [])) {
    const h = parserPlagesOuverture(fiche.plage_ouverture);
    if (h && !horaires.has(fiche.code_insee_commune)) horaires.set(fiche.code_insee_commune, h);
  }
  return horaires;
}

const horairesAVerifier = (p: any) => !!p.code_insee
  && (!p.horaires_verifies_le || Date.now() - new Date(p.horaires_verifies_le).getTime() > VALIDITE_HORAIRES_MS);

// Complète en place les horaires manquants ou trop vieux d'une liste de prospects, et les
// enregistre : une écriture par mairie qui publie des horaires (plafonnée à 15 par appel, le
// reste suivra au prochain chargement), une seule pour toutes celles qui n'en publient pas.
// Jamais bloquant : un annuaire indisponible laisse simplement les horaires inconnus.
async function completerHoraires(env: any, prospects: any[]): Promise<void> {
  const aVerifier = prospects.filter(horairesAVerifier).slice(0, 40);
  if (!aVerifier.length) return;
  try {
    const horaires = await horairesDepuisAnnuaire(aVerifier.map((p) => p.code_insee));
    const maintenant = new Date().toISOString();
    for (const p of aVerifier) p.horaires_ouverture = horaires.get(p.code_insee) ?? null;
    const avec = aVerifier.filter((p) => p.horaires_ouverture).slice(0, 15);
    const sans = aVerifier.filter((p) => !p.horaires_ouverture);
    await Promise.all([
      ...avec.map((p) => supabaseUpdate(env, 'prospects',
        { horaires_ouverture: p.horaires_ouverture, horaires_verifies_le: maintenant }, { id: `eq.${p.id}` })),
      sans.length ? supabaseUpdate(env, 'prospects',
        { horaires_ouverture: null, horaires_verifies_le: maintenant }, { id: `in.(${sans.map((p) => p.id).join(',')})` }) : null,
    ]);
  } catch { /* horaires simplement inconnus cette fois-ci */ }
}

app.post('/prospects/:id/enrichir', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,code_insee,contact_email,email_invalide', id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const maj = await enrichirDepuisAnnuaire(c.env, prospect);
  if (!maj) return c.json({ erreur: 'Aucune mairie trouvée dans l\'annuaire pour cette commune' }, 404);
  return c.json({ ok: true, prospect: maj });
});

// Correction en masse des emails invalides (bounces Resend) : retente l'annuaire pour chaque
// prospect flagué email_invalide, dans l'espoir d'une adresse plus à jour (ou confirmée, voir
// enrichirDepuisAnnuaire) que celle qui a rejeté. Partagé par le bouton backoffice et le cron
// quotidien (voir worker/src/cron.ts).
export async function corrigerEmailsInvalides(env: any): Promise<{ corriges: number; inchanges: number; erreurs: number }> {
  // Plafonné à 40 : chaque prospect coûte 2 sous-requêtes (annuaire externe + mise à jour), pas de
  // bulk possible côté annuaire (une commune à la fois) — même limite et mêmes raisons que
  // /prospecter-lot (Resend + sous-requêtes Worker). Le cron nocturne et ce bouton peuvent tous
  // deux être rejoués plusieurs fois pour vider un gros arriéré sur plusieurs passages.
  const prospects = await supabaseSelect(env, 'prospects', {
    select: 'id,code_insee,contact_email,email_invalide', email_invalide: 'eq.true', limit: '40',
  });
  let corriges = 0, inchanges = 0, erreurs = 0;
  for (const prospect of prospects) {
    // Chaque prospect isolé dans son propre try/catch (même pattern que traiterLot) : sans ça,
    // UNE SEULE réponse inattendue de l'annuaire (réseau, JSON invalide, commune sans fiche mal
    // formée...) faisait planter tout le lot en 500 plutôt que de corriger les autres — constaté
    // le 2026-08-31, persistait même après avoir réduit la taille du lot, signe que la vraie
    // cause n'était pas le volume mais un échec isolé jamais rattrapé.
    try {
      const maj = await enrichirDepuisAnnuaire(env, prospect);
      if (maj && maj.email_invalide === false) corriges += 1;
      else inchanges += 1;
    } catch (err) {
      console.error(`corrigerEmailsInvalides a échoué pour le prospect ${prospect.id} (INSEE ${prospect.code_insee}) :`, err);
      erreurs += 1;
    }
  }
  return { corriges, inchanges, erreurs };
}

app.post('/prospects/corriger-emails-invalides', async (c) => {
  const r = await corrigerEmailsInvalides(c.env);
  return c.json({ ok: true, ...r });
});

export type StatVariante = {
  nom: string;
  envoyes: number; ouverts: number; cliques: number; rejetes: number; connectes: number;
  envoyes_matures: number; ouverts_matures: number;
  premier_envoi_le: string | null; dernier_envoi_le: string | null;
  taux_ouverture_mature: number | null;
};

// Entonnoir envoyé → ouvert → cliqué → rejeté, par variante A/B, plus le signal le plus fiable
// de tous : le maire s'est-il RÉELLEMENT connecté au moins une fois à la commune activée
// (users.derniere_connexion_streak). Approximatif si un même prospect a reçu plusieurs envois
// sous des variantes différentes (la connexion est alors comptée pour chacune) — acceptable pour
// un funnel indicatif, pas un système de stats exhaustif. Exportée : réutilisée par
// gererVariantesProspectionAutomatiquement (prospection-ab.ts) pour décider d'une bascule.
export async function calculerStatsVariantes(env: any): Promise<StatVariante[]> {
  // Pagination complète : sur une grosse série d'envois, un simple limit élevé ne suffit pas
  // (Supabase plafonne à 1000 lignes par réponse, voir supabaseSelectTout dans db.ts).
  const envois = await supabaseSelectTout(env, 'envois_prospection', {
    select: 'prospect_id,variante,envoye_le,ouvert_le,clique_le,rejete_le', est_test: 'eq.false',
  });

  // Un envoi d'hier n'a pas fini d'être ouvert (les ouvertures s'étalent sur plusieurs jours) :
  // comparer le taux d'ouverture brut d'une variante ancienne à une variante récente favorise
  // artificiellement l'ancienne. On calcule donc aussi un taux "mature", restreint aux envois
  // vieux d'au moins 7 jours — comparable entre variantes quel que soit leur âge respectif.
  const seuilMaturite = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  // Pas de filtre par liste d'id (chunking par lots de 150) : ça plafonnait le nombre de
  // sous-requêtes autorisées par invocation une fois la campagne à plusieurs milliers de
  // prospects activés (500 constaté le 2026-08-19, la limite de lots précédente — bug du
  // 2026-08-18 — ne suffisait déjà plus). Un simple filtre commune_id/role, comme
  // GET /administration/communes, tient à n'importe quelle échelle : le nombre de requêtes ne
  // dépend que du nombre total de lignes (pagination par 1000), pas du nombre d'id à chercher.
  const prospectsActives = await supabaseSelectTout(env, 'prospects', {
    select: 'id,commune_id', commune_id: 'not.is.null',
  });
  const prospectCommune = new Map<string, string>();
  for (const p of prospectsActives) prospectCommune.set(p.id, p.commune_id);

  const maires = await supabaseSelectTout(env, 'users', {
    select: 'commune_id,derniere_connexion_streak', role: 'in.(admin,elu,maire,superadmin)',
  });
  const communesConnectees = new Set<string>();
  for (const m of maires) if (m.derniere_connexion_streak) communesConnectees.add(m.commune_id);

  type Stat = Omit<StatVariante, 'nom' | 'taux_ouverture_mature'>;
  const parVariante: Record<string, Stat> = {};
  for (const e of envois) {
    const cle = e.variante || '(sans nom)';
    const v = (parVariante[cle] ??= {
      envoyes: 0, ouverts: 0, cliques: 0, rejetes: 0, connectes: 0,
      envoyes_matures: 0, ouverts_matures: 0, premier_envoi_le: null, dernier_envoi_le: null,
    });
    v.envoyes += 1;
    if (e.ouvert_le) v.ouverts += 1;
    if (e.clique_le) v.cliques += 1;
    if (e.rejete_le) v.rejetes += 1;
    const communeId = e.prospect_id ? prospectCommune.get(e.prospect_id) : undefined;
    if (communeId && communesConnectees.has(communeId)) v.connectes += 1;

    if (e.envoye_le) {
      if (!v.premier_envoi_le || e.envoye_le < v.premier_envoi_le) v.premier_envoi_le = e.envoye_le;
      if (!v.dernier_envoi_le || e.envoye_le > v.dernier_envoi_le) v.dernier_envoi_le = e.envoye_le;
      if (e.envoye_le < seuilMaturite) {
        v.envoyes_matures += 1;
        if (e.ouvert_le) v.ouverts_matures += 1;
      }
    }
  }

  return Object.entries(parVariante)
    .map(([nom, v]) => ({
      nom, ...v,
      taux_ouverture_mature: v.envoyes_matures ? Math.round((v.ouverts_matures / v.envoyes_matures) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.envoyes - a.envoyes);
}

app.get('/stats-variantes', async (c) => {
  const variantes = await calculerStatsVariantes(c.env);
  return c.json({ variantes });
});

// — Slug unique pour une commune créée automatiquement (accents/majuscules retirés, dédoublonné
//   par suffixe numérique). Partagé avec la logique d'activation ci-dessous. —
function genererSlugBase(nom: string): string {
  return nom
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'commune';
}

export async function genererSlugUnique(env: any, nom: string): Promise<string> {
  const base = genererSlugBase(nom);
  const existants = await supabaseSelect(env, 'communes', { select: 'slug', slug: `like.${base}*` });
  const pris = new Set(existants.map((c: any) => c.slug));
  if (!pris.has(base)) return base;
  let n = 2;
  while (pris.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Active une VRAIE commune gratuite pour ce prospect s'il n'en a pas déjà une (plus de démo
// partagée), et (re)génère un mot de passe provisoire pour son compte à CHAQUE envoi — un
// prospect encore en cours de prospection n'a pas de mot de passe « définitif » à préserver ;
// une fois « gagné », ce flux n'est plus jamais appelé (voir prospecterUn, qui court-circuite
// avant). Décision business du 2026-08-17 : zéro friction, chaque prospect reçoit son propre
// espace fonctionnel dès le premier envoi de présentation, gratuitement.
// Rôle 'admin' (pas 'maire') depuis le 2026-10-06 : en pratique c'est quasi toujours le
// secrétariat qui lit ces emails en premier, jamais le maire lui-même — lui attribuer un
// rôle/nom de maire était trompeur. 'maire' reste réservé à un vrai maire désigné manuellement
// via la conversion (voir onboarding.ts). role: 'in.(admin,maire)' ci-dessous pour retrouver
// sans doublon les comptes déjà créés sous l'ancien comportement (role='maire').
export async function activerCommuneGratuite(env: any, prospect: any): Promise<{ slug: string; communeId: string; maireId: string; maireEmail: string; motDePasse: string }> {
  let communeId: string = prospect.commune_id || '';

  if (!communeId) {
    const slug = await genererSlugUnique(env, prospect.nom);
    const [commune] = await supabaseInsert(env, 'communes', {
      nom: prospect.nom, slug,
      population: prospect.population ?? null,
      lat: prospect.lat ?? null, lng: prospect.lng ?? null,
      // Sans département, la synchro Météo-France ignore la commune : aucune vigilance ni
      // notification (13 937 espaces créés ainsi d'août à octobre, rattrapés le 2026-11-19).
      departement: prospect.departement ?? null,
      // Sans ça, "Envoyer la présentation" échouait (422) sur la fiche commune pour la quasi-
      // totalité des communes issues de la prospection : contact_email/email_mairie restaient
      // nuls tant que personne ne les renseignait à la main.
      contact_email: prospect.contact_email ?? null,
      forfait: 'Gratuit', niveau_national: false,
    });
    communeId = commune.id;
    await appliquerOngletsSurCommune(env, communeId, await chargerOngletsGratuits(env));
    await supabaseUpdate(env, 'prospects', { commune_id: communeId }, { id: `eq.${prospect.id}` });
  }

  const [communeActuelle] = await supabaseSelect(env, 'communes', { select: 'slug', id: `eq.${communeId}` });

  const motDePasse = genererMotDePasseTemporaire();
  const [maire] = await supabaseSelect(env, 'users', {
    select: 'id,email', commune_id: `eq.${communeId}`, role: 'in.(admin,maire)', order: 'created_at.asc',
  });
  let maireEmail: string;
  let maireId: string;
  if (maire) {
    maireEmail = maire.email;
    maireId = maire.id;
    await supabaseUpdate(env, 'users', { password_hash: await hasherMotDePasse(motDePasse) }, { id: `eq.${maire.id}` });
  } else {
    maireEmail = prospect.contact_email;
    // Nom générique ("Administration" + nom de la commune) plutôt que le nom du maire : on ne
    // sait jamais, à ce stade, qui lit vraiment cet email (très souvent le secrétariat).
    // compte_provisionne=true (migration 073) : signale que ce compte est auto-créé, pas un vrai
    // citoyen/admin inscrit — exclu des compteurs "vrais citoyens" (apercu, activité, fiche
    // commune, voir administration.ts) indépendamment du rôle.
    const [nouveauMaire] = await supabaseInsert(env, 'users', {
      commune_id: communeId, email: maireEmail, password_hash: await hasherMotDePasse(motDePasse),
      prenom: 'Administration', nom: prospect.nom, role: 'admin', compte_provisionne: true,
      consentement_rgpd_le: new Date().toISOString(),
    });
    maireId = nouveauMaire.id;
  }

  return { slug: communeActuelle.slug, communeId, maireId, maireEmail, motDePasse };
}

// — Prospecter en un clic : enrichit si besoin, active une commune gratuite pour le prospect
//   (s'il n'en a pas déjà une), envoie l'email de présentation avec ses identifiants, journalise
//   l'échange, passe le statut à « contacté » et pose une relance à +7 jours. —
// Traite un prospect : enrichit si besoin, envoie l'email, journalise, met à jour statut/relance.
// Partagé par l'envoi unitaire et l'envoi groupé. Ne jette jamais : renvoie l'issue.
// Préparation commune à l'envoi direct (Resend) et au brouillon Outlook : adresse utilisable,
// activation de l'espace gratuit et identifiants du maire, contexte de l'email, carte de visite.
type PresentationPrete = {
  resultat: 'pret'; email: string; nouvelleActivation: boolean; activation: Awaited<ReturnType<typeof activerCommuneGratuite>>;
  ctx: ReturnType<typeof contextePresentation>; carteVisiteHtml: string;
};
async function preparerPresentation(env: any, prospect: any): Promise<PresentationPrete | { resultat: 'sans_email' | 'saute' }> {
  if (prospect.statut === 'gagne' || prospect.statut === 'perdu' || prospect.statut === 'ne_plus_contacter') return { resultat: 'saute' };

  let email = prospect.contact_email;
  let emailInvalide = prospect.email_invalide;
  // Adresse manquante OU connue pour avoir rejeté (bounce Resend) : on retente l'annuaire avant
  // d'abandonner. Protège la réputation d'expéditeur — on ne renvoie jamais aveuglément sur une
  // adresse déjà signalée fautive.
  if (!email || emailInvalide) {
    const maj = await enrichirDepuisAnnuaire(env, prospect);
    if (maj) { email = maj.contact_email; emailInvalide = maj.email_invalide; }
  }
  if (!email || emailInvalide) return { resultat: 'sans_email' };
  // Adresse désinscrite (lien en bas des emails, voir lib/desinscription.ts) : jamais de présentation.
  if (await adresseDesinscrite(env, email)) return { resultat: 'sans_email' };

  const nouvelleActivation = !prospect.commune_id;
  const activation = await activerCommuneGratuite(env, { ...prospect, contact_email: email });
  const ctx = contextePresentation(env.FRONTEND_URL, prospect.nom, activation.slug);
  if (prospect.nom_maire) { ctx.nomMaire = prospect.nom_maire; ctx.civiliteMaire = prospect.maire_civilite || undefined; }

  // Carte de visite jointe systématiquement (voir construireCarteVisite) : la commune vient
  // d'être activée juste au-dessus, donc communeId est toujours disponible ici — un seul clic
  // suffit à la mairie pour recevoir à la fois ses accès ET de quoi imprimer/distribuer, sans
  // devoir repasser par « Email libre » à part.
  const codeCourt = await codeCourtCommune(env, activation.communeId);
  const carteVisiteHtml = construireCarteVisite(prospect.nom, activation.slug, env.FRONTEND_URL, codeCourt);
  return { resultat: 'pret', email, nouvelleActivation, activation, ctx, carteVisiteHtml };
}

const identifiantsPresentation = (p: PresentationPrete) => ({
  maireEmail: p.activation.maireEmail, motDePasse: p.activation.motDePasse,
  slug: p.activation.slug, communeId: p.activation.communeId, userId: p.activation.maireId,
});

// Après une présentation (envoyée ou préparée dans Outlook) : statut « contacté », relance à
// +7 jours, et ligne dans l'historique lisible du prospect.
async function noterPresentation(env: any, staffId: string, prospect: any, texte: string) {
  const relance = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), prochaine_relance_le: relance, prochaine_relance_heure: null };
  if (prospect.statut === 'a_contacter') patch.statut = 'contacte';
  await supabaseUpdate(env, 'prospects', patch, { id: `eq.${prospect.id}` });
  await supabaseInsert(env, 'prospect_interactions', { prospect_id: prospect.id, staff_id: staffId, type: 'email', contenu: texte });
}

// — Prospecter en un clic : enrichit si besoin, active une commune gratuite pour le prospect
//   (s'il n'en a pas déjà une), envoie l'email de présentation avec ses identifiants, journalise
//   l'échange, passe le statut à « contacté » et pose une relance à +7 jours. —
// Partagé par l'envoi unitaire et l'envoi groupé. Ne jette jamais : renvoie l'issue.
async function prospecterUn(env: any, staffId: string, prospect: any): Promise<{ resultat: 'envoye' | 'sans_email' | 'saute'; email?: string }> {
  const prep = await preparerPresentation(env, prospect);
  if (prep.resultat !== 'pret') return { resultat: prep.resultat };

  const { variante, resendEmailId } = await envoyerPresentation(env, prep.email, prep.ctx, identifiantsPresentation(prep), undefined, prep.carteVisiteHtml);

  // Ligne dédiée au suivi structuré (rejet via webhook Resend, voir index.ts et migration 040) —
  // resend_email_id permet une corrélation précise, contrairement à un simple match par adresse
  // email qui serait ambigu en cas d'envois successifs au même contact.
  if (resendEmailId) {
    await supabaseInsert(env, 'envois_prospection', {
      prospect_id: prospect.id, resend_email_id: resendEmailId, email: prep.email, variante,
    });
  }
  // Trace la variante utilisée (A/B testing) et l'activation éventuelle dans l'historique lisible
  // du prospect (distinct du suivi structuré ci-dessus, qui alimente les stats agrégées).
  await noterPresentation(env, staffId, prospect,
    `Email de présentation envoyé à ${prep.email}${variante ? ` (variante : ${variante})` : ''}`
    + (prep.nouvelleActivation ? ` — commune activée gratuitement (${prep.activation.slug})` : ''));
  return { resultat: 'envoye', email: prep.email };
}

app.post('/prospects/:id/prospecter', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,departement,commune_id,nom_maire,prenom_maire,maire_civilite',
    id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const r = await prospecterUn(c.env, c.get('staff_id'), prospect);
  if (r.resultat === 'sans_email') return c.json({ erreur: 'Aucun email utilisable pour cette commune (adresse manquante, signalée en échec et non corrigée par l\'annuaire, ou désinscrite).' }, 422);
  if (r.resultat === 'saute') return c.json({ erreur: 'Ce prospect est déjà gagné ou perdu.' }, 400);
  return c.json({ ok: true, email: r.email });
});

// Une commune déjà activée (compte créé — voir prospect.commune_id) n'a plus besoin d'un email
// de « présentation » qui régénère un mot de passe potentiellement déjà utilisé par le maire :
// on envoie plutôt le même email de relance J+3 que la séquence d'onboarding automatique (voir
// onboarding-drip.ts), manuellement et sans ses contraintes de date/anti-doublon (décision de
// Léandre du 2026-08-26) — destinataireCommune() choisit le meilleur destinataire déjà connu.
async function relancerCommuneActivee(env: any, staffId: string, prospect: any): Promise<{ email: string | null }> {
  // Même garde que prospecterUn — manquait ici jusqu'au 2026-09-08 (une commune déjà activée
  // passait directement par cette fonction, sans jamais repasser par le contrôle de prospecterUn,
  // pour un prospect gagné/perdu/à ne plus contacter). Portée ici plutôt que dupliquée dans
  // chaque appelant (POST /prospects/:id/relancer, traiterLotRelance) : source de vérité unique.
  if (prospect.statut === 'gagne' || prospect.statut === 'perdu' || prospect.statut === 'ne_plus_contacter') return { email: null };

  const [commune] = await supabaseSelect(env, 'communes', { select: 'nom,slug', id: `eq.${prospect.commune_id}` });
  if (!commune) return { email: null };

  const destinataire = await destinataireCommune(env, prospect.commune_id, true);
  if (!destinataire) return { email: null };

  const ctx = contextePresentation(env.FRONTEND_URL, commune.nom, commune.slug);
  await envoyerModeleGenerique(env, 'onboarding_relance_j3', MODELE_ONBOARDING_RELANCE_J3_DEFAUT, destinataire, ctx);

  const relance = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  // Une commune déjà activée l'est forcément parce qu'on lui a déjà écrit au moins une fois
  // (voir activerCommuneGratuite, appelée uniquement depuis un envoi) — un statut encore à
  // "à_contacter" à ce stade est donc toujours obsolète, jamais un vrai signal. Même garde que
  // prospecterUn (l'envoi de la toute première présentation), pour que la répartition par statut
  // de l'aperçu Prospection ne sous-compte plus les communes réellement déjà contactées (bug
  // constaté sur Talence le 2026-08-31 : relancée avec succès, statut resté bloqué).
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), prochaine_relance_le: relance, prochaine_relance_heure: null };
  if (prospect.statut === 'a_contacter') patch.statut = 'contacte';
  await supabaseUpdate(env, 'prospects', patch, { id: `eq.${prospect.id}` });
  await supabaseInsert(env, 'prospect_interactions', {
    prospect_id: prospect.id, staff_id: staffId,
    type: 'email', contenu: `Email de relance (J+3, onboarding) envoyé à ${destinataire}`,
  });
  return { email: destinataire };
}

// POST /prospects/:id/relancer — bouton « 🔁 Relancer » de la fiche pilotage : bascule
// automatiquement entre les deux emails selon que la commune a déjà un compte ou non, pour que
// ce soit toujours le bon email en un seul clic (voir relancerCommuneActivee ci-dessus).
app.post('/prospects/:id/relancer', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,departement,commune_id,nom_maire,prenom_maire,maire_civilite',
    id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);
  if (prospect.statut === 'gagne' || prospect.statut === 'perdu' || prospect.statut === 'ne_plus_contacter') {
    return c.json({ erreur: 'Ce prospect est déjà gagné, perdu, ou a demandé à ne plus être contacté.' }, 400);
  }

  if (prospect.commune_id) {
    const r = await relancerCommuneActivee(c.env, c.get('staff_id'), prospect);
    if (!r.email) return c.json({ erreur: 'Aucun destinataire trouvé pour cette commune (aucun compte gestionnaire).' }, 422);
    return c.json({ ok: true, email: r.email, type: 'relance_j3' });
  }

  const r = await prospecterUn(c.env, c.get('staff_id'), prospect);
  if (r.resultat === 'sans_email') return c.json({ erreur: 'Aucun email utilisable pour cette commune (adresse manquante, signalée en échec et non corrigée par l\'annuaire, ou désinscrite).' }, 422);
  if (r.resultat === 'saute') return c.json({ erreur: 'Ce prospect est déjà gagné, perdu, ou a demandé à ne plus être contacté.' }, 400);
  return c.json({ ok: true, email: r.email, type: 'presentation' });
});

// Traite un lot de prospects en séquence, SANS jamais laisser l'échec d'un seul (données
// inattendues, timeout annuaire, etc.) interrompre les suivants ni faire planter toute la
// requête (500 opaque côté backoffice) — chaque prospect est isolé dans son propre try/catch.
async function traiterLot(env: any, staffId: string, prospects: any[]): Promise<{ envoyes: number; sans_email: number; ignores: number; erreurs: number }> {
  let envoyes = 0, sans_email = 0, ignores = 0, erreurs = 0;
  for (const prospect of prospects) {
    try {
      const r = await prospecterUn(env, staffId, prospect);
      if (r.resultat === 'envoye') envoyes += 1;
      else if (r.resultat === 'sans_email') sans_email += 1;
      else ignores += 1;
    } catch (err) {
      console.error(`prospecterUn a échoué pour le prospect ${prospect.id} (${prospect.nom}) :`, err);
      erreurs += 1;
    }
  }
  return { envoyes, sans_email, ignores, erreurs };
}

// — Envoi groupé : prospecte plusieurs communes sélectionnées en une fois. Plafonné (limites
//   Resend + sous-requêtes Worker + délivrabilité) et traité en séquence. —
const lotSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(40) });

app.post('/prospecter-lot', async (c) => {
  const body = lotSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Sélection invalide (1 à 40 communes par envoi).' }, 400);

  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,departement,commune_id,nom_maire,prenom_maire,maire_civilite',
    id: `in.(${body.data.ids.join(',')})`,
  });

  const r = await traiterLot(c.env, c.get('staff_id'), prospects);
  return c.json({ ok: true, ...r });
});

// Même bascule intelligente que POST /prospects/:id/relancer (présentation si jamais activé,
// relance J+3 sinon), appliquée à toute une sélection — voir relancerCommuneActivee plus haut.
// Isolé prospect par prospect comme traiterLot, mêmes raisons.
async function traiterLotRelance(env: any, staffId: string, prospects: any[]): Promise<{ envoyes: number; sans_email: number; ignores: number; erreurs: number }> {
  let envoyes = 0, sans_email = 0, ignores = 0, erreurs = 0;
  for (const prospect of prospects) {
    try {
      if (prospect.commune_id) {
        const r = await relancerCommuneActivee(env, staffId, prospect);
        if (r.email) envoyes += 1; else sans_email += 1;
        continue;
      }
      const r = await prospecterUn(env, staffId, prospect);
      if (r.resultat === 'envoye') envoyes += 1;
      else if (r.resultat === 'sans_email') sans_email += 1;
      else ignores += 1;
    } catch (err) {
      console.error(`traiterLotRelance a échoué pour le prospect ${prospect.id} (${prospect.nom}) :`, err);
      erreurs += 1;
    }
  }
  return { envoyes, sans_email, ignores, erreurs };
}

// POST /prospects/relancer-lot — bouton « Tout traiter » du tableau de bord Aujourd'hui (section
// « Prospects à relancer »). Même plafond que /prospecter-lot (40, limites Resend/sous-requêtes/
// délivrabilité) : au-delà, le frontend n'envoie que les 40 premiers ids et invite à recliquer
// pour la suite plutôt que de tout tenter d'un coup.
app.post('/prospects/relancer-lot', async (c) => {
  const body = lotSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Sélection invalide (1 à 40 prospects par envoi).' }, 400);

  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,departement,commune_id,nom_maire,prenom_maire,maire_civilite',
    id: `in.(${body.data.ids.join(',')})`,
  });

  const r = await traiterLotRelance(c.env, c.get('staff_id'), prospects);
  return c.json({ ok: true, ...r });
});

// PATCH /prospects/statut-lot — change le statut de plusieurs prospects d'un coup (ex. archiver
// en masse les perdus). Doit rester déclarée AVANT PATCH /prospects/:id ci-dessous, sinon Hono
// matche "statut-lot" comme un :id (même piège que candidats-rattrapage, voir plus haut).
const statutLotSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), statut: z.enum(STATUTS) });

app.patch('/prospects/statut-lot', async (c) => {
  const body = statutLotSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Sélection ou statut invalide (1 à 200 prospects).' }, 400);
  const staffId = c.get('staff_id');

  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,statut', id: `in.(${body.data.ids.join(',')})`,
  });

  // En deux écritures groupées (2026-11-03) plutôt que 2 requêtes par prospect : jusqu'à 400
  // requêtes pour 200 prospects, lent, et un lot coupé en route laissait une moitié modifiée.
  const aModifier = prospects.filter((p: any) => p.statut !== body.data.statut);
  if (aModifier.length) {
    await supabaseUpdate(c.env, 'prospects', { statut: body.data.statut, updated_at: new Date().toISOString() }, {
      id: `in.(${aModifier.map((p: any) => p.id).join(',')})`,
    });
    await supabaseInsert(c.env, 'prospect_interactions', aModifier.map((p: any) => ({
      prospect_id: p.id, staff_id: staffId,
      type: 'statut', contenu: `Statut : ${p.statut} → ${body.data.statut} (action groupée)`,
    })));
  }
  return c.json({ ok: true, modifies: aModifier.length });
});

// POST /prospects/corriger-statuts-actives — correction ponctuelle (bug découvert sur Talence le
// 2026-08-31) : bascule "à_contacter" → "contacté" pour tout prospect ayant déjà une commune
// activée (donc ayant forcément déjà reçu un envoi, voir activerCommuneGratuite) — cas que
// relancerCommuneActivee laissait jusqu'ici échapper au changement de statut (voir le correctif
// juste au-dessus, dans relancerCommuneActivee). Idempotent : ne retouche que ce qui est encore
// à corriger, sans risque à rejouer plusieurs fois.
app.post('/prospects/corriger-statuts-actives', async (c) => {
  const staffId = c.get('staff_id');
  const prospects = await supabaseSelectTout(c.env, 'prospects', {
    select: 'id', statut: 'eq.a_contacter', commune_id: 'not.is.null',
  });
  if (!prospects.length) return c.json({ ok: true, corriges: 0 });

  // Une seule requête pour TOUTES les lignes (filtre statut+commune_id, pas un id précis) plutôt
  // qu'une boucle de N updates — piège déjà rencontré sur ce projet (voir CLAUDE.md, incident de
  // la synchro RNE) : une boucle dépasse vite la limite de sous-requêtes par invocation Worker dès
  // que plusieurs dizaines de lignes sont concernées.
  await supabaseUpdate(c.env, 'prospects', {
    statut: 'contacte', updated_at: new Date().toISOString(),
  }, { statut: 'eq.a_contacter', commune_id: 'not.is.null' });

  await supabaseInsert(c.env, 'prospect_interactions', prospects.map((p: any) => ({
    prospect_id: p.id, staff_id: staffId,
    type: 'statut', contenu: 'Statut corrigé automatiquement : à contacter → contacté (commune déjà activée)',
  })));

  return c.json({ ok: true, corriges: prospects.length });
});

// Qualification d'un appel (lot 2, 2026-11-19) : ce que la mairie a dit, en menus déroulants
// pour pouvoir compter plus tard quel outil, quel irritant fait réagir. Les libellés vivent dans
// frontend/backoffice/js/app.js (QUALIFICATION) : toute valeur ajoutée ici doit l'être là-bas.
export const QUALIFICATION = {
  interlocuteur: ['secretaire', 'maire', 'adjoint', 'autre'],
  outil_actuel: ['rien', 'papier', 'facebook', 'site_web', 'panneaupocket', 'intramuros', 'illiwap', 'autre_appli'],
  irritant: ['temps', 'portee', 'appels', 'dechets', 'cout', 'satisfait', 'autre'],
  decideur: ['maire', 'conseil', 'interlocuteur', 'inconnu'],
  nb_communes: ['1', '2', '3_ou_plus'],
} as const;

// — Mise à jour (statut, notes, relance, contact). Un changement de statut ou d'email est
// journalisé dans la timeline (traçabilité : d'où vient une correction faite à la main).
const patchSchema = z.object({
  statut: z.enum(STATUTS).optional(),
  notes: z.string().max(5000).optional().nullable(),
  prochaine_relance_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  prochaine_relance_heure: z.string().regex(HEURE_REGEX).optional().nullable(),
  contact_email: z.string().email().optional().nullable(),
  etoiles: z.number().int().min(0).max(5).optional(),
  raison_perdu: z.string().max(500).optional().nullable(),
  qualification: z.object({
    interlocuteur: z.enum(QUALIFICATION.interlocuteur).nullable().optional(),
    outil_actuel: z.enum(QUALIFICATION.outil_actuel).nullable().optional(),
    irritant: z.enum(QUALIFICATION.irritant).nullable().optional(),
    decideur: z.enum(QUALIFICATION.decideur).nullable().optional(),
    nb_communes: z.enum(QUALIFICATION.nb_communes).nullable().optional(),
  }).strict().nullable().optional(),
});

// Un prospect "perdu" (refus explicite) ne doit pas juste disparaître du radar — voir le
// tableau "Pipeline de refus" de la vue Prospection. Délai posé automatiquement pour rester
// systématique (Léandre développe seul, rien ne doit reposer sur "il faut penser à programmer
// la relance") : 10 mois, milieu de la fourchette 9-12 mois validée le 2026-09-03. Ajustable au
// cas par cas ensuite via le champ "Prochaine relance" de la fiche, comme n'importe quel prospect.
const MOIS_RELANCE_APRES_REFUS = 10;

// Ajoute `mois` mois à une date ISO (YYYY-MM-DD), en gérant le débordement de fin de mois
// (ex: 31 janvier + 1 mois → 28/29 février, jamais "3 mars" comme le ferait un setMonth naïf).
function ajouterMois(dateIso: string, mois: number): string {
  const d = new Date(dateIso + 'T00:00:00Z');
  const jourVoulu = d.getUTCDate();
  d.setUTCDate(1); // évite qu'un débordement de setUTCMonth ci-dessous ne décale encore le mois
  d.setUTCMonth(d.getUTCMonth() + mois);
  const dernierJourDuMois = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(jourVoulu, dernierJourDuMois));
  return d.toISOString().slice(0, 10);
}

app.patch('/prospects/:id', async (c) => {
  const id = c.req.param('id');
  const body = patchSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'statut,contact_email,raison_perdu,prochaine_relance_le', id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.data.statut !== undefined) patch.statut = body.data.statut;
  if (body.data.notes !== undefined) patch.notes = body.data.notes;
  if (body.data.prochaine_relance_le !== undefined) patch.prochaine_relance_le = body.data.prochaine_relance_le;
  // L'heure de rappel n'a de sens que pour SA date : une date changée sans nouvelle heure l'efface.
  if (body.data.prochaine_relance_heure !== undefined) patch.prochaine_relance_heure = body.data.prochaine_relance_heure;
  else if (body.data.prochaine_relance_le !== undefined && body.data.prochaine_relance_le !== prospect.prochaine_relance_le) {
    patch.prochaine_relance_heure = null;
  }
  if (body.data.etoiles !== undefined) patch.etoiles = body.data.etoiles;
  if (body.data.raison_perdu !== undefined) patch.raison_perdu = body.data.raison_perdu;
  // Qualification : seules les rubriques remplies sont gardées ; tout vidé = null.
  if (body.data.qualification !== undefined) {
    const remplies = Object.entries(body.data.qualification || {}).filter(([, v]) => v);
    patch.qualification = remplies.length ? Object.fromEntries(remplies) : null;
  }
  if (body.data.contact_email !== undefined) {
    patch.contact_email = body.data.contact_email;
    // Une correction manuelle mérite un nouvel essai : sans ça, une adresse pourtant réparée à
    // la main resterait bloquée par le flag posé au précédent rejet Resend (même logique que
    // l'enrichissement automatique via l'annuaire, voir enrichirDepuisAnnuaire ci-dessus).
    if (body.data.contact_email && body.data.contact_email !== prospect.contact_email) patch.email_invalide = false;
  }
  // Passage EN statut "perdu" (pas déjà perdu) : date du refus + relance automatique, pour que
  // ce prospect reste dans le pipeline plutôt que de se perdre — voir MOIS_RELANCE_APRES_REFUS.
  // raison_perdu remise à zéro si non fournie dans ce même appel : un prospect relancé puis
  // refusé une seconde fois pour un motif différent ne doit pas garder affichée l'ancienne
  // raison (le staff est invité à la re-préciser sur la fiche, plutôt que de laisser une donnée
  // potentiellement fausse silencieusement en place).
  if (body.data.statut === 'perdu' && prospect.statut !== 'perdu') {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    patch.perdu_le = aujourdhui;
    if (body.data.raison_perdu === undefined) patch.raison_perdu = null;
    if (body.data.prochaine_relance_le === undefined) {
      patch.prochaine_relance_le = ajouterMois(aujourdhui, MOIS_RELANCE_APRES_REFUS);
      patch.prochaine_relance_heure = null;
    }
  }
  // Passage EN statut "ne_plus_contacter" : l'exact opposé de "perdu" ci-dessus — aucune relance
  // ne doit jamais être reprogrammée. On efface une éventuelle date déjà en place (héritée d'un
  // statut précédent, ex. "relance" ou "perdu") plutôt que de la laisser resurgir plus tard.
  if (body.data.statut === 'ne_plus_contacter' && prospect.statut !== 'ne_plus_contacter'
      && body.data.prochaine_relance_le === undefined) {
    patch.prochaine_relance_le = null;
    patch.prochaine_relance_heure = null;
  }

  await supabaseUpdate(c.env, 'prospects', patch, { id: `eq.${id}` });

  if (body.data.statut && body.data.statut !== prospect.statut) {
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id: id, staff_id: c.get('staff_id'),
      type: 'statut', contenu: `Statut : ${prospect.statut} → ${body.data.statut}`,
    });
  }
  if (body.data.raison_perdu !== undefined && body.data.raison_perdu !== prospect.raison_perdu) {
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id: id, staff_id: c.get('staff_id'),
      type: 'statut', contenu: `Raison du refus : ${body.data.raison_perdu || '(vide)'}`,
    });
  }
  if (body.data.contact_email !== undefined && body.data.contact_email !== prospect.contact_email) {
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id: id, staff_id: c.get('staff_id'),
      type: 'contact', contenu: `Email corrigé à la main : ${prospect.contact_email || '(vide)'} → ${body.data.contact_email || '(vide)'}`,
    });
  }
  return c.json({ ok: true });
});

// GET /favoris — prospects marqués d'une étoile (voir PATCH ci-dessus, champ etoiles), classés du
// plus étoilé au moins étoilé, pour le panneau "⭐ Favoris" du menu de gauche du backoffice
// (accès direct aux prospects prioritaires sans repasser par la liste/recherche complète).
// Depuis le 2026-11-05, aussi les communes SANS fiche prospect mises en favori (migration 099,
// ex. la vraie « eaucourt », créée avant la prospection). Chaque favori porte le slug de sa
// commune : deux communes du même nom (eaucourt / eaucourt-sur-somme, la commune de test de
// Léandre) restent ainsi distinguables dans le panneau.
app.get('/favoris', async (c) => {
  const [prospects, communesFavorites] = await Promise.all([
    supabaseSelect(c.env, 'prospects', {
      select: 'id,nom,etoiles,commune_id', etoiles: 'gt.0', order: 'etoiles.desc,nom.asc', limit: '50',
    }),
    // Colonne absente tant que la migration 099 n'est pas passée : on garde les favoris prospects.
    supabaseSelect(c.env, 'communes', {
      select: 'id,nom,slug,etoiles', etoiles: 'gt.0', limit: '50',
    }).catch(() => [] as any[]),
  ]);
  const idsCommunesProspects = prospects.map((p: any) => p.commune_id).filter(Boolean);
  const slugs = new Map<string, string>((idsCommunesProspects.length ? await supabaseSelect(c.env, 'communes', {
    select: 'id,slug', id: `in.(${idsCommunesProspects.join(',')})`,
  }) : []).map((cm: any) => [cm.id, cm.slug]));

  const favoris = [
    ...prospects.map((p: any) => ({ type: 'prospect', id: p.id, nom: p.nom, etoiles: p.etoiles, slug: slugs.get(p.commune_id) ?? null })),
    ...communesFavorites.map((cm: any) => ({ type: 'commune', id: cm.id, nom: cm.nom, etoiles: cm.etoiles, slug: cm.slug })),
  ].sort((a, b) => b.etoiles - a.etoiles || a.nom.localeCompare(b.nom, 'fr'));
  return c.json({ favoris });
});

// — Ajout d'une interaction (relance manuelle : note, appel, email...) —
const interactionSchema = z.object({
  type: z.enum(TYPES_INTERACTION),
  contenu: z.string().min(1).max(5000),
});

app.post('/prospects/:id/interactions', async (c) => {
  const id = c.req.param('id');
  const body = interactionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'id', id: `eq.${id}` });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const [interaction] = await supabaseInsert(c.env, 'prospect_interactions', {
    prospect_id: id, staff_id: c.get('staff_id'),
    type: body.data.type, contenu: body.data.contenu,
  });
  await supabaseUpdate(c.env, 'prospects', { updated_at: new Date().toISOString() }, { id: `eq.${id}` });
  return c.json({ ok: true, interaction });
});

// — Résultat d'un appel téléphonique (2026-11-19) : un seul geste journalise l'appel ET
// programme la suite, pour que rien ne repose sur « il faut penser à noter la relance ».
const RESULTATS_APPEL = ['pas_de_reponse', 'envoyer_mail', 'rappeler', 'demo', 'pas_interesse'] as const;
const resultatAppelSchema = z.object({
  resultat: z.enum(RESULTATS_APPEL),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  heure: z.string().regex(HEURE_REGEX).optional(),
  note: z.string().trim().max(2000).optional(),
}).refine((d) => !['rappeler', 'demo'].includes(d.resultat) || !!d.date, {
  message: 'Date obligatoire pour un rappel ou une démo', path: ['date'],
});

// Suite à donner selon le résultat. Un prospect « gagné » garde son statut (appel de suivi
// client) ; « à contacter » ou « perdu » repasse en « contacté » dès qu'un échange a vraiment eu
// lieu ; « pas de réponse » ne change jamais le statut (personne n'a été joint).
export function suiteAppel(
  saisie: z.infer<typeof resultatAppelSchema>,
  prospect: { statut: string; horaires_ouverture?: HorairesMairie | null },
  maintenant = new Date(),
): { statut: string; date: string; heure: string | null; contenu: string } {
  const aujourdhui = maintenantParis(maintenant).dateIso;
  const echange = ['a_contacter', 'perdu'].includes(prospect.statut) ? 'contacte' : prospect.statut;
  let statut = prospect.statut;
  let date: string;
  let heure: string | null = saisie.heure ?? null;
  let libelle: string;
  switch (saisie.resultat) {
    case 'pas_de_reponse': {
      const ouverture = prospect.horaires_ouverture ? prochaineOuverture(prospect.horaires_ouverture, maintenant) : null;
      date = ouverture?.date ?? prochainJourOuvre(aujourdhui);
      heure = ouverture?.heure ?? null;
      libelle = 'Pas de réponse';
      break;
    }
    case 'envoyer_mail':
      date = ajouterJours(aujourdhui, 3); heure = null; statut = echange; libelle = 'Demande un mail';
      break;
    case 'rappeler':
      date = saisie.date!; statut = echange; libelle = 'À rappeler';
      break;
    case 'demo':
      date = saisie.date!; statut = 'rdv'; libelle = 'Démo fixée';
      break;
    case 'pas_interesse':
      date = ajouterMois(aujourdhui, MOIS_RELANCE_APRES_REFUS); heure = null; statut = 'perdu'; libelle = 'Pas intéressé';
      break;
  }
  if (prospect.statut === 'gagne') statut = 'gagne';
  const quand = formaterDateCourte(date) + (heure ? ` à ${formaterHeure(heure)}` : '');
  const suite = saisie.resultat === 'demo' ? `démo le ${quand}`
    : saisie.resultat === 'pas_interesse' ? `nouvelle tentative le ${quand}` : `rappel le ${quand}`;
  return { statut, date, heure, contenu: `📞 ${libelle} — ${suite}` + (saisie.note ? `\n${saisie.note}` : '') };
}

app.post('/prospects/:id/resultat-appel', async (c) => {
  const id = c.req.param('id');
  const body = resultatAppelSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,statut,horaires_ouverture', id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);
  if (prospect.statut === 'ne_plus_contacter') {
    return c.json({ erreur: 'Ce prospect a demandé à ne plus être contacté.' }, 409);
  }

  const suite = suiteAppel(body.data, prospect);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    prochaine_relance_le: suite.date,
    prochaine_relance_heure: suite.heure,
  };
  if (suite.statut !== prospect.statut) patch.statut = suite.statut;
  // Même logique que le passage en « perdu » de PATCH /prospects/:id : date et raison du refus.
  if (body.data.resultat === 'pas_interesse' && suite.statut === 'perdu') {
    patch.perdu_le = maintenantParis().dateIso;
    patch.raison_perdu = body.data.note || null;
  }
  await supabaseUpdate(c.env, 'prospects', patch, { id: `eq.${id}` });

  const staffId = c.get('staff_id');
  const lignes = [{ prospect_id: id, staff_id: staffId, type: 'appel', contenu: suite.contenu }];
  if (patch.statut) {
    lignes.push({ prospect_id: id, staff_id: staffId, type: 'statut', contenu: `Statut : ${prospect.statut} → ${suite.statut}` });
  }
  await supabaseInsert(c.env, 'prospect_interactions', lignes);
  return c.json({ ok: true, statut: suite.statut, prochaine_relance_le: suite.date, prochaine_relance_heure: suite.heure });
});

function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}

// Code court unique par commune, pour un lien /q/<code> assez court à encoder dans le générateur
// QR maison (plafonné à 42 caractères, voir CLAUDE.md — plateforme-agora.fr/q/<code> ne fait que
// 36 caractères avec un code à 6, largement sous la limite, contrairement à l'URL complète de
// l'app). Généré paresseusement au premier besoin (voir migration 052) : rien à backfiller.
const ALPHABET_CODE_COURT = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I, ambigus à relire
function genererCodeCourtAleatoire(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET_CODE_COURT[Math.floor(Math.random() * ALPHABET_CODE_COURT.length)];
  return code;
}

async function codeCourtCommune(env: any, communeId: string): Promise<string | null> {
  const [commune] = await supabaseSelect(env, 'communes', { select: 'code_court', id: `eq.${communeId}` });
  if (commune?.code_court) return commune.code_court;

  for (let tentative = 0; tentative < 5; tentative++) {
    const code = genererCodeCourtAleatoire();
    const existants = await supabaseSelect(env, 'communes', { select: 'id', code_court: `eq.${code}` });
    if (existants.length) continue; // collision rarissime (33^6 possibilités) : on retente
    await supabaseUpdate(env, 'communes', { code_court: code }, { id: `eq.${communeId}` });
    return code;
  }
  return null; // échec improbable après 5 tentatives : la carte s'affiche simplement sans QR
}

// "Carte de visite" de la commune — mêmes couleurs que la fiche imprimable (fiche.html : navy
// #1c3b57, vert #2c5f2d, or #b9791a, corail #c85a3f), avec un vrai QR scannable (voir
// codeCourtCommune ci-dessus et worker/src/routes/liens_courts.ts pour le lien court qui rend ça
// possible malgré la limite de 42 caractères du générateur). Le bouton "Fiche à imprimer" reste
// le lien vers fiche.html (le vrai document à distribuer, format A4) ; le QR ici est un raccourci
// pratique directement scannable depuis la carte elle-même.
// Refonte du 2026-08-26 (retour de Léandre) : la carte est copiée-collée par la mairie pour être
// imprimée et distribuée aux administrés — un bandeau plein en dégradé navy coûte cher en encre et
// "bande" sur une imprimante de mairie standard. Fond blanc dominant, navy réduit à un filet fin
// (bordure du bandeau, contour du badge logo) : plus de dégradé du tout, donc plus de fondu à régler.
// Le QR passe devant (colonne de gauche, agrandi) puisque c'est le geste principal attendu du
// destinataire papier ; la légende explicite "avec l'appareil photo" pour un public non-technophile.
// Pièges email HTML (Outlook desktop notamment) : bandeau et QR bâtis en <table>, jamais flex/grid ;
// l'URL de l'app reste aussi en texte brut sous le bouton, lisible même imprimée sans lien cliquable.
function construireCarteVisite(nomCommune: string, slug: string, frontendUrl: string, codeCourt: string | null): string {
  const nom = echapper(nomCommune);
  const urlApp = `${frontendUrl}/${encodeURIComponent(slug)}/`;
  const urlAppTexte = echapper(urlApp.replace(/^https?:\/\//, ''));
  const urlFiche = `${frontendUrl}/backoffice/fiche?slug=${encodeURIComponent(slug)}&nom=${encodeURIComponent(nomCommune)}`;
  const urlLogo = `${frontendUrl}/icons/agora-icone-1024-fond-transparent.png`;

  const blocQr = codeCourt ? `
        <td valign="top" width="146" style="text-align:center;padding-right:20px">
          <div style="display:inline-block;background:#ffffff;border:2px solid #1c3b57;border-radius:12px;padding:9px;line-height:0">
            <img src="${frontendUrl}/q/${codeCourt}/qr.svg" width="128" height="128" alt="QR code vers l'app" style="display:block;width:128px;height:128px" />
          </div>
          <div style="font-size:10px;color:#6b7680;margin-top:7px;line-height:1.3">📱 Scannez avec l'appareil photo</div>
        </td>` : '';

  return `
  <div style="margin:28px auto 0;max-width:520px;border-radius:14px;overflow:hidden;border:1.5px solid #1c3b57;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#ffffff">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:20px 24px 14px" valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td valign="middle" style="padding-right:12px">
              <div style="width:40px;height:40px;border-radius:50%;background:#1c3b57;text-align:center;line-height:40px">
                <img src="${urlLogo}" width="26" height="26" alt="Plateforme-Agora" style="display:inline-block;vertical-align:middle;width:26px;height:26px" />
              </div>
            </td>
            <td valign="middle">
              <div style="font-size:20px;font-weight:800;color:#1c3b57;letter-spacing:-.3px">Ag<span style="color:#2c5f2d">o</span>ra</div>
              <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7680;margin-top:1px">La plateforme citoyenne de ${nom}</div>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr><td style="height:2px;background:#1c3b57;font-size:0;line-height:0">&nbsp;</td></tr>
    </table>
    <div style="padding:20px 24px 22px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${blocQr}
        <td valign="middle">
          <p style="font-size:14.5px;color:#1c2226;line-height:1.6;margin:0 0 14px">
            Actus, agenda, alertes, entraide entre voisins… tout ${nom} au même endroit, gratuitement.
          </p>
          <a href="${urlApp}" style="display:inline-block;background:#2c5f2d;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:999px">Ouvrir l'app →</a>
          <div style="margin-top:8px;font-size:11.5px;color:#8a9199">${urlAppTexte}</div>
        </td>
      </tr></table>
      <div style="margin-top:16px;padding-top:16px;border-top:1px dashed #e3e7ea">
        <a href="${urlFiche}" style="color:#b9791a;font-weight:700;font-size:13px;text-decoration:none">🖨 Fiche à imprimer avec QR code — à distribuer aux administrés</a>
      </div>
    </div>
    <div style="height:5px;background:#1c3b57;background:linear-gradient(90deg,#1c3b57 25%,#2c5f2d 25%,#2c5f2d 50%,#b9791a 50%,#b9791a 75%,#c85a3f 75%)"></div>
  </div>`;
}

// Simple mise en forme : texte libre échappé, sauts de ligne convertis, dans le même habillage
// minimal que les autres emails de prospection (voir email-commune.ts). Pas d'éditeur riche côté
// client : ce mail est volontairement du texte brut, pour un mot personnel plutôt qu'un modèle.
// carteVisiteHtml (optionnel) : voir construireCarteVisite ci-dessus.
function construireEmailLibre(message: string, carteVisiteHtml?: string): string {
  const corps = echapper(message).replace(/\n/g, '<br>');
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Plateforme<span style="color:#4a8c4a">-</span>Agora</div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de votre commune</div>
    <div style="font-size:15px;color:#3a4a3b;line-height:1.6">${corps}</div>
    ${carteVisiteHtml || ''}
  </div>`;
}

// — Email libre (pas de modèle A/B, un mot personnalisé) — reply_to identique aux envois de
// présentation : une réponse remonte dans Réponses reçues comme n'importe quel autre échange.
const emailLibreSchema = z.object({
  objet: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  inclure_carte: z.boolean().optional(),
});

app.post('/prospects/:id/envoyer-email-libre', async (c) => {
  const id = c.req.param('id');
  const body = emailLibreSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,commune_id,contact_email', id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);
  if (!prospect.contact_email) return c.json({ erreur: 'Aucun email de contact pour ce prospect.' }, 422);

  let carteVisiteHtml: string | undefined;
  if (body.data.inclure_carte && prospect.commune_id) {
    const [commune] = await supabaseSelect(c.env, 'communes', { select: 'slug', id: `eq.${prospect.commune_id}` });
    if (commune?.slug) {
      const codeCourt = await codeCourtCommune(c.env, prospect.commune_id);
      carteVisiteHtml = construireCarteVisite(prospect.nom, commune.slug, c.env.FRONTEND_URL, codeCourt);
    }
  }

  if (await adresseDesinscrite(c.env, prospect.contact_email)) {
    return c.json({ erreur: 'Cette adresse a demandé à ne plus recevoir nos emails (désinscription). Ne pas la relancer.' }, 409);
  }
  const resendEmailId = await envoyerEmailSuivi(
    c.env, prospect.contact_email, body.data.objet, construireEmailLibre(body.data.message, carteVisiteHtml),
    undefined, c.env.EMAIL_REPLY_TO_PROSPECTION, undefined, copieEnvois(c.env),
  );
  if (!resendEmailId) return c.json({ erreur: 'Échec de l\'envoi (Resend indisponible).' }, 502);

  await supabaseInsert(c.env, 'prospect_interactions', {
    prospect_id: id, staff_id: c.get('staff_id'),
    type: 'email', contenu: `Email libre envoyé à ${prospect.contact_email} — objet : ${body.data.objet}\n\n${body.data.message}`,
  });
  await supabaseUpdate(c.env, 'prospects', { updated_at: new Date().toISOString() }, { id: `eq.${id}` });
  return c.json({ ok: true });
});

// — Brouillon Outlook (2026-11-25, demandé par Léandre) : au lieu d'envoyer depuis le backoffice,
// fabrique un fichier .eml qu'Outlook ouvre en mode rédaction (lib/eml.ts) — même mise en forme que
// l'envoi Resend, pièces jointes en PDF au choix (documents-pdf.ts). Léandre relit et envoie depuis
// son propre compte. Mêmes garde-fous que l'envoi : adresse désinscrite refusée, lien de
// désinscription en bas, réponses vers « Réponses reçues », trace dans l'historique Échanges.
// Présentation : l'espace est activé et le mot de passe du maire renouvelé dès la préparation
// (comme à l'envoi), puisque les identifiants figurent dans l'email.
const brouillonSchema = z.object({
  modele: z.enum(['presentation', 'libre']),
  objet: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().min(1).max(5000).optional(),
  inclure_carte: z.boolean().optional(),
  documents: z.array(z.enum(DOCUMENTS_PDF)).max(DOCUMENTS_PDF.length).default([]),
}).strict().refine((b) => b.modele === 'presentation' || (!!b.objet && !!b.message), 'Objet et message requis pour un email libre.');

app.post('/prospects/:id/brouillon-outlook', async (c) => {
  const id = c.req.param('id');
  const body = brouillonSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: body.error.issues[0]?.message ?? 'Données invalides' }, 400);
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,departement,commune_id,nom_maire,prenom_maire,maire_civilite',
    id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);
  const documents = [...new Set(body.data.documents)];

  let destinataire: string;
  let objet: string;
  let html: string;
  let slug: string | null = null;
  let presentation: PresentationPrete | null = null;
  let historique: string;
  if (body.data.modele === 'presentation') {
    const prep = await preparerPresentation(c.env, prospect);
    if (prep.resultat !== 'pret') {
      return prep.resultat === 'saute'
        ? c.json({ erreur: 'Ce prospect est déjà gagné ou perdu.' }, 400)
        : c.json({ erreur: 'Aucun email utilisable pour cette commune (adresse manquante, signalée en échec, ou désinscrite).' }, 422);
    }
    const p = await construirePresentation(c.env, prep.ctx, identifiantsPresentation(prep), undefined, prep.carteVisiteHtml);
    presentation = prep;
    destinataire = prep.email; objet = p.objet; html = p.html; slug = prep.activation.slug;
    historique = `Brouillon Outlook de présentation préparé pour ${prep.email}${p.variante ? ` (variante : ${p.variante})` : ''}`
      + (prep.nouvelleActivation ? ` — commune activée gratuitement (${prep.activation.slug})` : '');
  } else {
    if (!prospect.contact_email) return c.json({ erreur: 'Aucun email de contact pour ce prospect.' }, 422);
    if (await adresseDesinscrite(c.env, prospect.contact_email)) {
      return c.json({ erreur: 'Cette adresse a demandé à ne plus recevoir nos emails (désinscription). Ne pas la relancer.' }, 409);
    }
    if (prospect.commune_id) {
      const [commune] = await supabaseSelect(c.env, 'communes', { select: 'slug', id: `eq.${prospect.commune_id}` });
      slug = commune?.slug ?? null;
    }
    const carte = body.data.inclure_carte && slug
      ? construireCarteVisite(prospect.nom, slug, c.env.FRONTEND_URL, await codeCourtCommune(c.env, prospect.commune_id))
      : undefined;
    destinataire = prospect.contact_email; objet = body.data.objet!; html = construireEmailLibre(body.data.message!, carte);
    historique = `Brouillon Outlook (email libre) préparé pour ${destinataire} — objet : ${objet}\n\n${body.data.message}`;
  }

  const indisponibles = documents.filter((d) => !documentDisponible(d, slug));
  if (indisponibles.length) return c.json({ erreur: 'Ces documents demandent l\'espace de la commune, pas encore créé : envoyez d\'abord la présentation.' }, 400);
  let pieces: Awaited<ReturnType<typeof fabriquerPdfDocuments>>;
  try {
    pieces = await fabriquerPdfDocuments(c.env, c.get('staff_id'), { slug, nom: prospect.nom, prospectId: id }, documents);
  } catch (e) {
    if (e instanceof ErreurPdf) return c.json({ erreur: e.message }, 502);
    throw e;
  }

  const { corps } = await avecPiedDesinscription(c.env, destinataire, html);
  const eml = construireEml({
    de: c.env.EMAIL_FROM || 'Plateforme-Agora <contact@plateforme-agora.fr>', a: destinataire,
    repondreA: c.env.EMAIL_REPLY_TO_PROSPECTION, objet, html: corps, pieces,
  });
  historique += pieces.length ? `\nPièces jointes : ${pieces.map((p) => p.nom).join(', ')}` : '';
  if (presentation) {
    await noterPresentation(c.env, c.get('staff_id'), prospect, historique);
  } else {
    await supabaseInsert(c.env, 'prospect_interactions', { prospect_id: id, staff_id: c.get('staff_id'), type: 'email', contenu: historique });
    await supabaseUpdate(c.env, 'prospects', { updated_at: new Date().toISOString() }, { id: `eq.${id}` });
  }
  const nomFichier = `Email - ${prospect.nom}.eml`;
  return new Response(eml, {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': `attachment; filename="${nomFichier.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nomFichier)}`,
      'Cache-Control': 'no-store',
    },
  });
});

// GET /prospects/:id/carte-visite — aperçu de la carte de visite (voir construireCarteVisite
// ci-dessus), pour affichage direct dans la fiche : Léandre peut la voir puis la copier-coller
// à la main dans un email tapé ailleurs (sa propre messagerie), sans passer par « Email libre ».
// null tant que la commune n'est pas activée (pas de slug à pointer).
app.get('/prospects/:id/carte-visite', async (c) => {
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'nom,commune_id', id: `eq.${c.req.param('id')}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);
  if (!prospect.commune_id) return c.json({ html: null });

  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'slug', id: `eq.${prospect.commune_id}` });
  if (!commune?.slug) return c.json({ html: null });

  const codeCourt = await codeCourtCommune(c.env, prospect.commune_id);
  return c.json({ html: construireCarteVisite(prospect.nom, commune.slug, c.env.FRONTEND_URL, codeCourt) });
});

export default app;

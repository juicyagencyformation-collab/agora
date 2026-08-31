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
import { envoyerPresentation, contextePresentation, genererMotDePasseTemporaire, envoyerModeleGenerique, MODELE_ONBOARDING_RELANCE_J3_DEFAUT } from './email-commune';
import { chargerOngletsGratuits, appliquerOngletsSurCommune } from './administration';
import { destinataireCommune } from './onboarding-drip';
import { synchroniserEmailsRecus } from './emails-recus';
import { hasherMotDePasse } from '../lib/password';
import { versCsv } from '../lib/csv';
import { envoyerEmail } from '../lib/email';

const app = new Hono();
app.use('*', backofficeMiddleware);

const STATUTS = ['a_contacter', 'contacte', 'relance', 'rdv', 'gagne', 'perdu'] as const;
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

// nom_maire est stocké déjà combiné ("Prénom Nom", voir formaterNomMaire ci-dessus) ; retrouve le
// seul nom de famille en retirant le préfixe prénom — évite une 3e colonne juste pour ça. Utilisé
// pour créer/corriger le compte maire avec son VRAI prénom/nom (voir activerCommuneGratuite et
// POST /synchroniser-maires) plutôt que le placeholder "Maire de {commune}".
function nomFamilleMaire(nomMaire: string, prenomMaire: string): string {
  return nomMaire.startsWith(prenomMaire) ? nomMaire.slice(prenomMaire.length).trim() : nomMaire;
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
  // Communes déjà activées (compte maire déjà créé) à corriger après coup — voir la boucle
  // corrective plus bas : le placeholder mis à la création n'a plus lieu d'être maintenant qu'on
  // identifie le vrai prénom/nom.
  const aCorrigerCoteUsers: { communeId: string; prenom: string; nom: string }[] = [];
  for (let i = 1; i < lignesTexte.length; i++) {
    if (!lignesTexte[i]) continue;
    const ligne = lignesTexte[i].split(';');
    const codeInsee = ligne[iCode];
    const prospect = codeInsee ? prospectParCodeInsee.get(codeInsee) : undefined;
    if (!prospect) continue;
    const nom = ligne[iNom], prenom = ligne[iPrenom];
    if (!nom || !prenom) continue;
    const sexe = iSexe >= 0 ? ligne[iSexe] : '';
    const nomMaireForme = formaterNomMaire(nom, prenom);
    const prenomMaireForme = prenom.trim();
    maj.push({
      code_insee: codeInsee,
      nom: prospect.nom,
      departement: prospect.departement,
      nom_maire: nomMaireForme,
      prenom_maire: prenomMaireForme,
      maire_civilite: sexe === 'F' ? 'Madame' : sexe === 'M' ? 'Monsieur' : null,
    });
    if (prospect.commune_id) {
      aCorrigerCoteUsers.push({
        communeId: prospect.commune_id, prenom: prenomMaireForme,
        nom: nomFamilleMaire(nomMaireForme, prenomMaireForme),
      });
    }
  }

  if (maj.length) {
    try {
      await supabaseUpsert(c.env, 'prospects', maj, 'code_insee');
    } catch (err: any) {
      console.error('synchroniser-maires — écriture en base échouée :', err);
      return c.json({ erreur: `Écriture en base impossible (${chrono()}, ${maj.length} ligne(s)) : ${err?.message || err}` }, 500);
    }
  }

  // Corrige les comptes maire déjà créés qui portent encore le placeholder "Maire de {commune}"
  // (jamais touché depuis, ni par le maire lui-même ni par une correction manuelle — condition
  // volontairement stricte pour ne jamais écraser un nom que le maire aurait modifié à la main
  // depuis son profil).
  let comptesCorriges = 0;
  for (const { communeId, prenom, nom } of aCorrigerCoteUsers) {
    const [maire] = await supabaseSelect(c.env, 'users', {
      select: 'id,prenom', commune_id: `eq.${communeId}`, role: 'eq.maire', prenom: 'eq.Maire de',
    });
    if (!maire) continue;
    await supabaseUpdate(c.env, 'users', { prenom, nom }, { id: `eq.${maire.id}` });
    comptesCorriges += 1;
  }

  return c.json({ ok: true, mis_a_jour: maj.length, total_prospects: existants.length, comptes_maire_corriges: comptesCorriges });
});

// — Liste (filtres sobres : statut, département, recherche) —
const TRIS: Record<string, string> = {
  nom: 'nom.asc',
  departement: 'departement.asc,nom.asc',
  population_desc: 'population.desc.nullslast',
  population_asc: 'population.asc.nullslast',
};

const TAILLE_PAGE_PROSPECTS = 100;

// Communes dont le maire s'est réellement connecté au moins une fois (users.role='maire',
// derniere_connexion_streak posé) — le signal le plus fiable de tous, voir /stats-variantes.
// Résilient (table users toujours présente, mais on protège quand même comme pour communesInscrites).
async function chargerCommunesConnectees(env: any): Promise<Set<string>> {
  const maires = await supabaseSelectTout(env, 'users', {
    select: 'commune_id,derniere_connexion_streak', role: 'eq.maire',
  }).catch(() => []);
  return new Set(maires.filter((m: any) => m.derniere_connexion_streak).map((m: any) => m.commune_id));
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

  // Signal "🔑 le maire s'est connecté" : le plus fiable de tous, plus fort qu'une simple
  // ouverture d'email. ?maire_connecte=1 filtre la liste dessus.
  const idsCommunesConnectees = await chargerCommunesConnectees(c.env);

  let idsFiltreCommune: Set<string> | null = null;
  if (c.req.query('inscrits') === '1') idsFiltreCommune = idsCommunesInscrites;
  if (c.req.query('maire_connecte') === '1') {
    idsFiltreCommune = idsFiltreCommune
      ? new Set([...idsFiltreCommune].filter((id) => idsCommunesConnectees.has(id)))
      : idsCommunesConnectees;
  }
  if (idsFiltreCommune) {
    where.commune_id = idsFiltreCommune.size
      ? `in.(${[...idsFiltreCommune].join(',')})`
      : 'eq.00000000-0000-0000-0000-000000000000'; // aucune commune correspondante : liste volontairement vide
  }

  const tri = c.req.query('tri');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const offset = (page - 1) * TAILLE_PAGE_PROSPECTS;

  const [prospects, total] = await Promise.all([
    supabaseSelect(c.env, 'prospects', {
      ...where,
      select: 'id,code_insee,nom,departement,population,statut,contact_email,email_invalide,prochaine_relance_le,commune_id,nom_maire',
      order: (tri && TRIS[tri]) || TRIS.nom,
      limit: String(TAILLE_PAGE_PROSPECTS),
      offset: String(offset),
    }),
    supabaseCount(c.env, 'prospects', where),
  ]);

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
    if (c.req.query('maire_connecte') === '1') {
      const idsCommunesConnectees = await chargerCommunesConnectees(c.env);
      where.commune_id = idsCommunesConnectees.size
        ? `in.(${[...idsCommunesConnectees].join(',')})`
        : 'eq.00000000-0000-0000-0000-000000000000';
    }
  }

  // Export = tout ce qui correspond, donc pagination complète (même piège que /apercu : un
  // simple limit élevé ne suffit pas, Supabase plafonne à 1000 lignes par réponse).
  const prospects = await supabaseSelectTout(c.env, 'prospects', {
    ...where,
    select: 'nom,departement,population,statut,nom_maire,contact_email,contact_telephone,site_web,prochaine_relance_le,created_at',
    order: 'nom.asc',
  });
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
    c.env, email.expediteur, objet, corps, undefined, c.env.EMAIL_REPLY_TO_PROSPECTION, enTetes,
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
  // Contactés (au sens large : ont reçu au moins une présentation) mais toujours sans commune
  // réelle — ce que traite « Activer et renvoyer ». Distingué de ceux déjà activés, pour
  // vérifier précisément l'avancement du rattrapage plutôt que de se fier à un seul message.
  let contactes_sans_commune = 0;
  let contactes_avec_commune = 0;
  const STATUTS_CONTACTES = ['contacte', 'relance', 'rdv'];
  for (const p of prospects) {
    parStatut[p.statut] = (parStatut[p.statut] ?? 0) + 1;
    if (p.prochaine_relance_le && p.prochaine_relance_le <= aujourdhui &&
        p.statut !== 'gagne' && p.statut !== 'perdu') a_relancer += 1;
    if (STATUTS_CONTACTES.includes(p.statut)) {
      if (p.commune_id) contactes_avec_commune += 1;
      else contactes_sans_commune += 1;
    }
  }
  return c.json({
    total: prospects.length, par_statut: parStatut, a_relancer,
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

// — Fiche + timeline —
app.get('/prospects/:id', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,code_insee,nom,code_postal,departement,population,statut,contact_email,contact_telephone,site_web,adresse,notes,prochaine_relance_le,enrichi_le,commune_id,created_at,nom_maire,prenom_maire,maire_civilite,etoiles',
    id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  // Le slug ne vit que sur communes (créée à l'activation, voir activerCommuneGratuite) : sans
  // lui, impossible de personnaliser un lien vers la fiche de présentation ou son QR pour CE
  // prospect précis — jusqu'ici seul l'écran de conversion manuelle l'avait sous la main.
  let commune_slug: string | null = null;
  let maire_connecte = false;
  if (prospect.commune_id) {
    const [commune] = await supabaseSelect(c.env, 'communes', { select: 'slug', id: `eq.${prospect.commune_id}` });
    commune_slug = commune?.slug || null;
    // Signal le plus fiable de tous (voir /stats-variantes) : le maire s'est-il RÉELLEMENT
    // connecté au moins une fois à la commune activée pour ce prospect.
    const [maire] = await supabaseSelect(c.env, 'users', {
      select: 'derniere_connexion_streak', commune_id: `eq.${prospect.commune_id}`, role: 'eq.maire',
    });
    maire_connecte = !!maire?.derniere_connexion_streak;
  }

  const interactions = await supabaseSelect(c.env, 'prospect_interactions', {
    select: 'type,contenu,created_at', prospect_id: `eq.${id}`, order: 'created_at.desc',
  });
  return c.json({ prospect: { ...prospect, commune_slug, maire_connecte }, interactions });
});

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
    + `&select=nom,adresse_courriel,telephone,adresse,site_internet&limit=1`;
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
export async function corrigerEmailsInvalides(env: any): Promise<{ corriges: number; inchanges: number }> {
  // Plafonné à 40 : chaque prospect coûte 2 sous-requêtes (annuaire externe + mise à jour), pas de
  // bulk possible côté annuaire (une commune à la fois) — même limite et mêmes raisons que
  // /prospecter-lot (Resend + sous-requêtes Worker). Un passage à 300 dépassait la limite dès
  // qu'un gros lot de bounces arrivait d'un coup (constaté le 2026-08-31, ~200 bounces Orange en
  // une journée) : 500 opaque plutôt qu'une correction, même sur les prospects traitables avant
  // la limite. Le cron nocturne et ce bouton peuvent tous deux être rejoués plusieurs fois pour
  // vider un gros arriéré sur plusieurs passages plutôt qu'en un seul.
  const prospects = await supabaseSelect(env, 'prospects', {
    select: 'id,code_insee,contact_email,email_invalide', email_invalide: 'eq.true', limit: '40',
  });
  let corriges = 0, inchanges = 0;
  for (const prospect of prospects) {
    const maj = await enrichirDepuisAnnuaire(env, prospect);
    if (maj && maj.email_invalide === false) corriges += 1;
    else inchanges += 1;
  }
  return { corriges, inchanges };
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
    select: 'commune_id,derniere_connexion_streak', role: 'eq.maire',
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

async function genererSlugUnique(env: any, nom: string): Promise<string> {
  const base = genererSlugBase(nom);
  const existants = await supabaseSelect(env, 'communes', { select: 'slug', slug: `like.${base}*` });
  const pris = new Set(existants.map((c: any) => c.slug));
  if (!pris.has(base)) return base;
  let n = 2;
  while (pris.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Active une VRAIE commune gratuite pour ce prospect s'il n'en a pas déjà une (plus de démo
// partagée), et (re)génère un mot de passe provisoire pour son compte maire à CHAQUE envoi — un
// prospect encore en cours de prospection n'a pas de mot de passe « définitif » à préserver ;
// une fois « gagné », ce flux n'est plus jamais appelé (voir prospecterUn, qui court-circuite
// avant). Décision business du 2026-08-17 : zéro friction, chaque prospect reçoit son propre
// espace fonctionnel dès le premier envoi de présentation, gratuitement.
async function activerCommuneGratuite(env: any, prospect: any): Promise<{ slug: string; communeId: string; maireId: string; maireEmail: string; motDePasse: string }> {
  let communeId: string = prospect.commune_id || '';

  if (!communeId) {
    const slug = await genererSlugUnique(env, prospect.nom);
    const [commune] = await supabaseInsert(env, 'communes', {
      nom: prospect.nom, slug,
      population: prospect.population ?? null,
      lat: prospect.lat ?? null, lng: prospect.lng ?? null,
      forfait: 'Gratuit', niveau_national: false,
    });
    communeId = commune.id;
    await appliquerOngletsSurCommune(env, communeId, await chargerOngletsGratuits(env));
    await supabaseUpdate(env, 'prospects', { commune_id: communeId }, { id: `eq.${prospect.id}` });
  }

  const [communeActuelle] = await supabaseSelect(env, 'communes', { select: 'slug', id: `eq.${communeId}` });

  const motDePasse = genererMotDePasseTemporaire();
  const [maire] = await supabaseSelect(env, 'users', {
    select: 'id,email', commune_id: `eq.${communeId}`, role: 'eq.maire', order: 'created_at.asc',
  });
  let maireEmail: string;
  let maireId: string;
  if (maire) {
    maireEmail = maire.email;
    maireId = maire.id;
    await supabaseUpdate(env, 'users', { password_hash: await hasherMotDePasse(motDePasse) }, { id: `eq.${maire.id}` });
  } else {
    maireEmail = prospect.contact_email;
    // Vrai prénom/nom quand le maire a été identifié via le RNE (voir POST /synchroniser-maires) ;
    // repli sur un placeholder générique sinon plutôt que de bloquer l'activation — corrigé
    // automatiquement dès qu'une synchronisation RNE ultérieure identifie ce maire (voir la boucle
    // corrective de /synchroniser-maires).
    const prenom = prospect.prenom_maire || 'Maire de';
    const nom = prospect.prenom_maire && prospect.nom_maire
      ? nomFamilleMaire(prospect.nom_maire, prospect.prenom_maire)
      : prospect.nom;
    const [nouveauMaire] = await supabaseInsert(env, 'users', {
      commune_id: communeId, email: maireEmail, password_hash: await hasherMotDePasse(motDePasse),
      prenom, nom, role: 'maire',
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
async function prospecterUn(env: any, staffId: string, prospect: any): Promise<{ resultat: 'envoye' | 'sans_email' | 'saute'; email?: string }> {
  if (prospect.statut === 'gagne' || prospect.statut === 'perdu') return { resultat: 'saute' };

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

  const { variante, resendEmailId } = await envoyerPresentation(env, email, ctx, {
    maireEmail: activation.maireEmail, motDePasse: activation.motDePasse,
    slug: activation.slug, communeId: activation.communeId, userId: activation.maireId,
  }, undefined, carteVisiteHtml);

  // Ligne dédiée au suivi structuré (ouverture/clic/rejet via webhook Resend, voir index.ts et
  // migration 040) — resend_email_id permet une corrélation précise, contrairement à un simple
  // match par adresse email qui serait ambigu en cas d'envois successifs au même contact.
  if (resendEmailId) {
    await supabaseInsert(env, 'envois_prospection', {
      prospect_id: prospect.id, resend_email_id: resendEmailId, email, variante,
    });
  }

  const relance = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), prochaine_relance_le: relance };
  if (prospect.statut === 'a_contacter') patch.statut = 'contacte';
  await supabaseUpdate(env, 'prospects', patch, { id: `eq.${prospect.id}` });

  // Trace la variante utilisée (A/B testing) et l'activation éventuelle dans l'historique lisible
  // du prospect (distinct du suivi structuré ci-dessus, qui alimente les stats agrégées).
  await supabaseInsert(env, 'prospect_interactions', {
    prospect_id: prospect.id, staff_id: staffId,
    type: 'email',
    contenu: `Email de présentation envoyé à ${email}${variante ? ` (variante : ${variante})` : ''}`
      + (nouvelleActivation ? ` — commune activée gratuitement (${activation.slug})` : ''),
  });
  return { resultat: 'envoye', email };
}

app.post('/prospects/:id/prospecter', async (c) => {
  const id = c.req.param('id');
  const [prospect] = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,commune_id,nom_maire,prenom_maire,maire_civilite',
    id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const r = await prospecterUn(c.env, c.get('staff_id'), prospect);
  if (r.resultat === 'sans_email') return c.json({ erreur: 'Aucun email valide pour cette commune (adresse manquante, ou signalée en échec et non corrigée par l\'annuaire).' }, 422);
  if (r.resultat === 'saute') return c.json({ erreur: 'Ce prospect est déjà gagné ou perdu.' }, 400);
  return c.json({ ok: true, email: r.email });
});

// Une commune déjà activée (compte créé — voir prospect.commune_id) n'a plus besoin d'un email
// de « présentation » qui régénère un mot de passe potentiellement déjà utilisé par le maire :
// on envoie plutôt le même email de relance J+3 que la séquence d'onboarding automatique (voir
// onboarding-drip.ts), manuellement et sans ses contraintes de date/anti-doublon (décision de
// Léandre du 2026-08-26) — destinataireCommune() choisit le meilleur destinataire déjà connu.
async function relancerCommuneActivee(env: any, staffId: string, prospect: any): Promise<{ email: string | null }> {
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
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), prochaine_relance_le: relance };
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
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,commune_id,nom_maire,prenom_maire,maire_civilite',
    id: `eq.${id}`,
  });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  if (prospect.commune_id) {
    const r = await relancerCommuneActivee(c.env, c.get('staff_id'), prospect);
    if (!r.email) return c.json({ erreur: 'Aucun destinataire trouvé pour cette commune (aucun compte gestionnaire).' }, 422);
    return c.json({ ok: true, email: r.email, type: 'relance_j3' });
  }

  const r = await prospecterUn(c.env, c.get('staff_id'), prospect);
  if (r.resultat === 'sans_email') return c.json({ erreur: 'Aucun email valide pour cette commune (adresse manquante, ou signalée en échec et non corrigée par l\'annuaire).' }, 422);
  if (r.resultat === 'saute') return c.json({ erreur: 'Ce prospect est déjà gagné ou perdu.' }, 400);
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
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,commune_id,nom_maire,prenom_maire,maire_civilite',
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
    select: 'id,nom,code_insee,contact_email,email_invalide,statut,population,lat,lng,commune_id,nom_maire,prenom_maire,maire_civilite',
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

  let modifies = 0;
  for (const prospect of prospects) {
    if (prospect.statut === body.data.statut) continue;
    await supabaseUpdate(c.env, 'prospects', { statut: body.data.statut, updated_at: new Date().toISOString() }, { id: `eq.${prospect.id}` });
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id: prospect.id, staff_id: staffId,
      type: 'statut', contenu: `Statut : ${prospect.statut} → ${body.data.statut} (action groupée)`,
    });
    modifies += 1;
  }
  return c.json({ ok: true, modifies });
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

// — Mise à jour (statut, notes, relance, contact). Un changement de statut ou d'email est
// journalisé dans la timeline (traçabilité : d'où vient une correction faite à la main).
const patchSchema = z.object({
  statut: z.enum(STATUTS).optional(),
  notes: z.string().max(5000).optional().nullable(),
  prochaine_relance_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  contact_email: z.string().email().optional().nullable(),
  etoiles: z.number().int().min(0).max(5).optional(),
});

app.patch('/prospects/:id', async (c) => {
  const id = c.req.param('id');
  const body = patchSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);

  const [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'statut,contact_email', id: `eq.${id}` });
  if (!prospect) return c.json({ erreur: 'Prospect introuvable' }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.data.statut !== undefined) patch.statut = body.data.statut;
  if (body.data.notes !== undefined) patch.notes = body.data.notes;
  if (body.data.prochaine_relance_le !== undefined) patch.prochaine_relance_le = body.data.prochaine_relance_le;
  if (body.data.etoiles !== undefined) patch.etoiles = body.data.etoiles;
  if (body.data.contact_email !== undefined) {
    patch.contact_email = body.data.contact_email;
    // Une correction manuelle mérite un nouvel essai : sans ça, une adresse pourtant réparée à
    // la main resterait bloquée par le flag posé au précédent rejet Resend (même logique que
    // l'enrichissement automatique via l'annuaire, voir enrichirDepuisAnnuaire ci-dessus).
    if (body.data.contact_email && body.data.contact_email !== prospect.contact_email) patch.email_invalide = false;
  }

  await supabaseUpdate(c.env, 'prospects', patch, { id: `eq.${id}` });

  if (body.data.statut && body.data.statut !== prospect.statut) {
    await supabaseInsert(c.env, 'prospect_interactions', {
      prospect_id: id, staff_id: c.get('staff_id'),
      type: 'statut', contenu: `Statut : ${prospect.statut} → ${body.data.statut}`,
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
app.get('/favoris', async (c) => {
  const prospects = await supabaseSelect(c.env, 'prospects', {
    select: 'id,nom,etoiles', etoiles: 'gt.0', order: 'etoiles.desc,nom.asc', limit: '50',
  });
  return c.json({ prospects });
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
                <img src="${urlLogo}" width="26" height="26" alt="Agora" style="display:inline-block;vertical-align:middle;width:26px;height:26px" />
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
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
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

  const resendEmailId = await envoyerEmail(
    c.env, prospect.contact_email, body.data.objet, construireEmailLibre(body.data.message, carteVisiteHtml),
    undefined, c.env.EMAIL_REPLY_TO_PROSPECTION,
  );
  if (!resendEmailId) return c.json({ erreur: 'Échec de l\'envoi (Resend indisponible).' }, 502);

  await supabaseInsert(c.env, 'prospect_interactions', {
    prospect_id: id, staff_id: c.get('staff_id'),
    type: 'email', contenu: `Email libre envoyé à ${prospect.contact_email} — objet : ${body.data.objet}`,
  });
  await supabaseUpdate(c.env, 'prospects', { updated_at: new Date().toISOString() }, { id: `eq.${id}` });
  return c.json({ ok: true });
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

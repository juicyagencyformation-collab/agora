// worker/src/routes/annuaire.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';
import { statutResponsable, fichesPublicationPossible } from '../lib/associations';
import { envoyerNotificationAUtilisateurs } from '../lib/push';

const app = new Hono();

// Au plus 3 demandes « Je fais partie du bureau » en attente par habitant : au-delà, c'est un
// abus (ou une erreur), et chaque demande notifie la mairie.
const MAX_DEMANDES_EN_ATTENTE = 3;

// Modifier une fiche : la mairie, son créateur, ou un responsable actif (association).
async function peutModifierFiche(env: any, commune_id: string, fiche: any, user_id: string, role: string): Promise<boolean> {
  if (estGestionnaire(role) || fiche.user_id === user_id) return true;
  return (await statutResponsable(env, commune_id, fiche.id, user_id)) === 'actif';
}

// Prévient les gestionnaires qu'une demande de responsable attend leur validation — en
// arrière-plan : un envoi raté ne doit jamais faire échouer la demande.
function notifierDemandeResponsable(c: any, commune_id: string, nomFiche: string) {
  c.executionCtx.waitUntil((async () => {
    const gestionnaires = await supabaseSelect(c.env, 'users', {
      select: 'id', commune_id: `eq.${commune_id}`, role: 'in.(admin,elu,maire,superadmin)',
      compte_supprime_le: 'is.null',
    });
    await envoyerNotificationAUtilisateurs(
      c.env, commune_id, gestionnaires.map((g: any) => g.id),
      '🤝 Demande d\'association', `Un habitant demande à gérer la fiche « ${nomFiche} »`, '/index.html?onglet=annuaire',
    );
  })().catch(() => {}));
}
app.use('*', jwtMiddleware);

const CATEGORIES_VALIDES = ['commerce', 'artisan', 'association', 'service_public', 'professionnel', 'autre'] as const;

// .optional() seul n'exempte pas la chaîne vide ('') du format .email()/.url() — un champ
// laissé vide par le formulaire (mais bien envoyé comme '') serait alors rejeté à tort.
const documentSchema = z.object({
  r2_key: z.string().min(1),
  type: z.enum(['pdf', 'image']),
  nom_original: z.string().max(150).optional(),
});

const creationSchema = z.object({
  nom: z.string().min(1).max(150),
  categorie: z.enum(CATEGORIES_VALIDES),
  description: z.string().max(1000).optional(),
  // Texte libre multi-lignes (plusieurs numéros possibles, ex: "Président : 06...") — la
  // détection auto de liens (frontend/js/utils.js) rend chaque numéro cliquable au rendu.
  telephone: z.string().max(300).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
  site_web: z.string().url().max(300).optional().or(z.literal('')),
  logo_r2_key: z.string().optional(),
  documents: z.array(documentSchema).max(10).optional(),
});

function champsFiche(env: any, data: z.infer<typeof creationSchema>) {
  return {
    nom: data.nom, categorie: data.categorie,
    description: data.description ?? null,
    telephone: data.telephone ?? null,
    email: data.email || null,
    site_web: data.site_web || null,
    logo_r2_key: data.logo_r2_key ?? null,
    logo_url: data.logo_r2_key ? `${env.R2_PUBLIC_BASE}/${data.logo_r2_key}` : null,
  };
}

async function ajouterDocuments(env: any, commune_id: string, fiche_id: string, documents?: z.infer<typeof documentSchema>[]) {
  if (!documents?.length) return;
  await supabaseInsert(env, 'annuaire_documents', documents.map((doc, i) => ({
    commune_id, fiche_id, r2_key: doc.r2_key, type: doc.type,
    nom_original: doc.nom_original ?? null,
    url: `${env.R2_PUBLIC_BASE}/${doc.r2_key}`, ordre: i,
  })));
}

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const categorie = c.req.query('categorie');

  const filtres: Record<string, string> = {
    select: 'id,user_id,nom,categorie,description,telephone,email,site_web,logo_url',
    commune_id: `eq.${commune_id}`,
    order: 'nom.asc',
  };
  if (categorie && CATEGORIES_VALIDES.includes(categorie as any)) filtres.categorie = `eq.${categorie}`;

  const fiches = await supabaseSelect(c.env, 'annuaire', filtres);
  const ids = fiches.map((f: any) => f.id);
  const documents = ids.length ? await supabaseSelect(c.env, 'annuaire_documents', {
    select: 'id,fiche_id,url,type,nom_original,ordre',
    commune_id: `eq.${commune_id}`,
    fiche_id: `in.(${ids.join(',')})`,
    order: 'ordre.asc',
  }) : [];

  // Responsables (migration 101) : jamais la liste brute (qui gère quoi) aux habitants — seulement
  // « fiche tenue par l'association », et pour l'appelant, ses propres fiches gérées / demandées.
  const user_id = c.get('user_id');
  const gestionnaire = estGestionnaire(c.get('role'));
  const responsables = ids.length ? await supabaseSelect(c.env, 'annuaire_responsables', {
    select: 'id,fiche_id,user_id,statut,created_at',
    commune_id: `eq.${commune_id}`,
    fiche_id: `in.(${ids.join(',')})`,
  }) : [];

  const result = fiches.map((f: any) => {
    const lignes = responsables.filter((r: any) => r.fiche_id === f.id);
    const mienne = lignes.find((r: any) => r.user_id === user_id);
    return {
      ...f,
      documents: documents.filter((d: any) => d.fiche_id === f.id),
      tenue_par_association: lignes.some((r: any) => r.statut === 'actif'),
      mon_statut_responsable: mienne?.statut ?? null,
    };
  });

  // Gestionnaires : demandes en attente (nom complet du demandeur — outil de gestion, la mairie
  // doit savoir qui elle valide), affichées en tête de l'annuaire.
  let demandes_en_attente: any[] = [];
  const enAttente = responsables.filter((r: any) => r.statut === 'demande');
  if (gestionnaire && enAttente.length) {
    const demandeurs = await supabaseSelect(c.env, 'users', {
      select: 'id,prenom,nom', commune_id: `eq.${commune_id}`,
      id: `in.(${[...new Set(enAttente.map((r: any) => r.user_id))].join(',')})`,
    });
    demandes_en_attente = enAttente.map((r: any) => {
      const u = demandeurs.find((d: any) => d.id === r.user_id);
      const fiche = fiches.find((f: any) => f.id === r.fiche_id);
      return { id: r.id, fiche_id: r.fiche_id, fiche_nom: fiche?.nom, prenom: u?.prenom ?? '?', nom: u?.nom ?? '', created_at: r.created_at };
    });
  }

  return c.json({ fiches: result, demandes_en_attente });
});

// POST / — un citoyen crée SA fiche (liée à son compte, une seule autorisée) ;
// un gestionnaire peut créer une fiche libre (commerce/association sans compte).
app.post('/', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  if (!estGestionnaire(role)) {
    // Citoyen simple : uniquement sa propre fiche, une seule
    const [existante] = await supabaseSelect(c.env, 'annuaire', {
      select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
    });
    if (existante) return c.json({ erreur: 'Vous avez déjà une fiche dans l\'annuaire (modifiez-la plutôt)' }, 400);

    const [fiche] = await supabaseInsert(c.env, 'annuaire', {
      commune_id, user_id, ...champsFiche(c.env, data),
    });
    await ajouterDocuments(c.env, commune_id, fiche.id, data.documents);
    // Association créée par un habitant : il la gère déjà en tant que créateur, mais ne devient
    // responsable reconnu (publications au nom de l'association, lot 2) qu'après validation.
    if (data.categorie === 'association') {
      await supabaseInsert(c.env, 'annuaire_responsables', { commune_id, fiche_id: fiche.id, user_id, statut: 'demande' });
      notifierDemandeResponsable(c, commune_id, data.nom);
    }
    return c.json({ fiche_id: fiche.id }, 201);
  }

  // Gestionnaire : fiche libre, sans compte lié (commerce, association...)
  const [fiche] = await supabaseInsert(c.env, 'annuaire', {
    commune_id, user_id: null, ...champsFiche(c.env, data),
  });
  await ajouterDocuments(c.env, commune_id, fiche.id, data.documents);
  return c.json({ fiche_id: fiche.id }, 201);
});

app.patch('/:id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const fiche_id = c.req.param('id');

  const [fiche] = await supabaseSelect(c.env, 'annuaire', {
    select: 'id,user_id,logo_r2_key', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}`,
  });
  if (!fiche) return c.json({ erreur: 'Fiche introuvable' }, 404);
  if (!(await peutModifierFiche(c.env, commune_id, fiche, user_id, role))) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  const body = creationSchema.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à modifier' }, 400);

  // La catégorie reste à la mairie (et au créateur) : un responsable d'association ne peut pas
  // reclasser sa fiche (en « service public », par exemple).
  if (!estGestionnaire(role) && fiche.user_id !== user_id) delete body.data.categorie;

  const { documents, ...champsModifiables } = body.data;
  const patch: Record<string, unknown> = { ...champsModifiables };
  if ('email' in patch) patch.email = champsModifiables.email || null;
  if ('site_web' in patch) patch.site_web = champsModifiables.site_web || null;
  if ('logo_r2_key' in patch) {
    patch.logo_url = champsModifiables.logo_r2_key ? `${c.env.R2_PUBLIC_BASE}/${champsModifiables.logo_r2_key}` : null;
    if (fiche.logo_r2_key && fiche.logo_r2_key !== champsModifiables.logo_r2_key) {
      await deleteObject(c.env, fiche.logo_r2_key);
    }
  }

  if (Object.keys(patch).length) {
    await supabaseUpdate(c.env, 'annuaire', patch, { id: `eq.${fiche_id}`, commune_id: `eq.${commune_id}` });
  }
  await ajouterDocuments(c.env, commune_id, fiche_id, documents);
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const fiche_id = c.req.param('id');

  const [fiche] = await supabaseSelect(c.env, 'annuaire', {
    select: 'id,user_id,logo_r2_key', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}`,
  });
  if (!fiche) return c.json({ erreur: 'Fiche introuvable' }, 404);
  if (fiche.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }
  // Le créateur d'une fiche reprise par d'autres responsables (nouveau bureau) ne peut plus la
  // supprimer seul : seule la mairie le peut alors.
  if (!estGestionnaire(role)) {
    const autres = await supabaseSelect(c.env, 'annuaire_responsables', {
      select: 'id', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}`,
      statut: 'eq.actif', user_id: `neq.${user_id}`,
    });
    if (autres.length) return c.json({ erreur: 'Cette fiche est gérée par d\'autres responsables : seule la mairie peut la supprimer.' }, 403);
  }

  const documents = await supabaseSelect(c.env, 'annuaire_documents', {
    select: 'r2_key', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}`,
  });
  // Publications de l'association (migration 102) : supprimées en cascade avec la fiche, mais
  // leurs photos/affiches sont dans R2 — on les efface ici, sinon elles resteraient orphelines.
  const [articlesAsso, eventsAsso] = await Promise.all([
    supabaseSelect(c.env, 'articles', { select: 'id', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}` }),
    supabaseSelect(c.env, 'events', { select: 'r2_key', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}` }),
  ]);
  const imagesArticles = articlesAsso.length ? await supabaseSelect(c.env, 'article_images', {
    select: 'r2_key', commune_id: `eq.${commune_id}`, article_id: `in.(${articlesAsso.map((a: any) => a.id).join(',')})`,
  }) : [];
  const clesPublications = [...imagesArticles, ...eventsAsso].map((x: any) => x.r2_key).filter(Boolean);
  await Promise.all([
    ...(fiche.logo_r2_key ? [deleteObject(c.env, fiche.logo_r2_key)] : []),
    ...documents.map((d: any) => deleteObject(c.env, d.r2_key)),
    ...clesPublications.map((cle: string) => deleteObject(c.env, cle)),
  ]);

  await supabaseDelete(c.env, 'annuaire', { id: `eq.${fiche_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// DELETE /:id/documents/:doc_id — retire un document précis d'une fiche (propriétaire ou
// gestionnaire), sans toucher au reste de la fiche.
app.delete('/:id/documents/:doc_id', async (c) => {
  const role = c.get('role');
  const user_id = c.get('user_id');
  const commune_id = c.get('commune_id');
  const fiche_id = c.req.param('id');
  const doc_id = c.req.param('doc_id');

  const [fiche] = await supabaseSelect(c.env, 'annuaire', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}`,
  });
  if (!fiche) return c.json({ erreur: 'Fiche introuvable' }, 404);
  if (!(await peutModifierFiche(c.env, commune_id, fiche, user_id, role))) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  const [document] = await supabaseSelect(c.env, 'annuaire_documents', {
    select: 'id,r2_key', commune_id: `eq.${commune_id}`, id: `eq.${doc_id}`, fiche_id: `eq.${fiche_id}`,
  });
  if (!document) return c.json({ erreur: 'Document introuvable' }, 404);

  await deleteObject(c.env, document.r2_key);
  await supabaseDelete(c.env, 'annuaire_documents', { id: `eq.${doc_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// ── Responsables d'association (migration 101) ──────────────────────────────────────────────
// Seule une fiche « association » a des responsables. La mairie (gestionnaires) valide les
// demandes, désigne directement un habitant déjà inscrit (par son email, sans exposer la liste
// des habitants), et retire un responsable ; un responsable peut aussi se retirer lui-même.

// GET /publier-pour — associations au nom desquelles l'appelant peut publier (menu « Publier
// pour » des formulaires Actualités / Agenda) : toutes pour la mairie, ses fiches gérées sinon.
app.get('/publier-pour', async (c) => {
  const fiches = await fichesPublicationPossible(c.env, c.get('commune_id'), c.get('user_id'), c.get('role'));
  return c.json({ associations: fiches });
});

async function chargerFicheAssociation(env: any, commune_id: string, fiche_id: string) {
  const [fiche] = await supabaseSelect(env, 'annuaire', {
    select: 'id,nom,categorie', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}`,
  });
  return fiche?.categorie === 'association' ? fiche : null;
}

// POST /:id/responsables/demande — « Je fais partie du bureau »
app.post('/:id/responsables/demande', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const fiche = await chargerFicheAssociation(c.env, commune_id, c.req.param('id'));
  if (!fiche) return c.json({ erreur: 'Association introuvable' }, 404);

  const existante = await statutResponsable(c.env, commune_id, fiche.id, user_id);
  if (existante === 'actif') return c.json({ erreur: 'Vous gérez déjà cette association.' }, 409);
  if (existante === 'demande') return c.json({ erreur: 'Votre demande est déjà en attente auprès de la mairie.' }, 409);

  const enAttente = await supabaseSelect(c.env, 'annuaire_responsables', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, statut: 'eq.demande',
  });
  if (enAttente.length >= MAX_DEMANDES_EN_ATTENTE) {
    return c.json({ erreur: 'Vous avez déjà plusieurs demandes en attente : la mairie doit d\'abord y répondre.' }, 429);
  }

  await supabaseInsert(c.env, 'annuaire_responsables', { commune_id, fiche_id: fiche.id, user_id, statut: 'demande' });
  notifierDemandeResponsable(c, commune_id, fiche.nom);
  return c.json({ ok: true }, 201);
});

// GET /:id/responsables — liste complète (gestionnaires), noms complets : outil de gestion.
app.get('/:id/responsables', async (c) => {
  if (!estGestionnaire(c.get('role'))) return c.json({ erreur: 'Réservé à la mairie' }, 403);
  const commune_id = c.get('commune_id');
  const fiche = await chargerFicheAssociation(c.env, commune_id, c.req.param('id'));
  if (!fiche) return c.json({ erreur: 'Association introuvable' }, 404);

  const lignes = await supabaseSelect(c.env, 'annuaire_responsables', {
    select: 'id,user_id,statut,created_at', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche.id}`,
    order: 'created_at.asc',
  });
  const personnes = lignes.length ? await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom', commune_id: `eq.${commune_id}`,
    id: `in.(${lignes.map((l: any) => l.user_id).join(',')})`,
  }) : [];
  const responsables = lignes.map((l: any) => {
    const u = personnes.find((p: any) => p.id === l.user_id);
    return { id: l.id, statut: l.statut, prenom: u?.prenom ?? '?', nom: u?.nom ?? '', created_at: l.created_at };
  });
  return c.json({ responsables });
});

// POST /:id/responsables — la mairie désigne un habitant inscrit, par son email.
const designationSchema = z.object({ email: z.string().trim().email().max(200) });

app.post('/:id/responsables', async (c) => {
  if (!estGestionnaire(c.get('role'))) return c.json({ erreur: 'Réservé à la mairie' }, 403);
  const commune_id = c.get('commune_id');
  const fiche = await chargerFicheAssociation(c.env, commune_id, c.req.param('id'));
  if (!fiche) return c.json({ erreur: 'Association introuvable' }, 404);

  const body = designationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Adresse email invalide' }, 400);

  // ilike pour ignorer la casse (comme à la connexion), jokers % et _ neutralisés : une adresse
  // contenant « _ » ne doit jamais désigner quelqu'un d'autre.
  const motif = body.data.email.replace(/[\\%_]/g, (m) => `\\${m}`);
  const [habitant] = await supabaseSelect(c.env, 'users', {
    select: 'id', commune_id: `eq.${commune_id}`, email: `ilike.${motif}`, compte_supprime_le: 'is.null',
  });
  if (!habitant) {
    return c.json({ erreur: 'Aucun habitant inscrit avec cette adresse. Demandez-lui de créer son compte, puis recommencez.' }, 404);
  }

  const statut = await statutResponsable(c.env, commune_id, fiche.id, habitant.id);
  if (statut === 'actif') return c.json({ erreur: 'Cette personne gère déjà cette association.' }, 409);
  const validation = { statut: 'actif', valide_par: c.get('user_id'), valide_le: new Date().toISOString() };
  if (statut === 'demande') {
    await supabaseUpdate(c.env, 'annuaire_responsables', validation, {
      commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche.id}`, user_id: `eq.${habitant.id}`,
    });
  } else {
    await supabaseInsert(c.env, 'annuaire_responsables', { commune_id, fiche_id: fiche.id, user_id: habitant.id, ...validation });
  }
  return c.json({ ok: true }, 201);
});

// PATCH /:id/responsables/:rid — la mairie valide une demande.
app.patch('/:id/responsables/:rid', async (c) => {
  if (!estGestionnaire(c.get('role'))) return c.json({ erreur: 'Réservé à la mairie' }, 403);
  const commune_id = c.get('commune_id');
  const [ligne] = await supabaseSelect(c.env, 'annuaire_responsables', {
    select: 'id,statut', commune_id: `eq.${commune_id}`, fiche_id: `eq.${c.req.param('id')}`, id: `eq.${c.req.param('rid')}`,
  });
  if (!ligne) return c.json({ erreur: 'Demande introuvable' }, 404);
  if (ligne.statut === 'actif') return c.json({ ok: true });

  await supabaseUpdate(c.env, 'annuaire_responsables',
    { statut: 'actif', valide_par: c.get('user_id'), valide_le: new Date().toISOString() },
    { id: `eq.${ligne.id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// DELETE /:id/responsables/:rid — la mairie refuse une demande ou retire un responsable ;
// un habitant peut retirer sa propre ligne (« Ne plus gérer cette association »).
app.delete('/:id/responsables/:rid', async (c) => {
  const commune_id = c.get('commune_id');
  const [ligne] = await supabaseSelect(c.env, 'annuaire_responsables', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, fiche_id: `eq.${c.req.param('id')}`, id: `eq.${c.req.param('rid')}`,
  });
  if (!ligne) return c.json({ erreur: 'Responsable introuvable' }, 404);
  if (ligne.user_id !== c.get('user_id') && !estGestionnaire(c.get('role'))) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }
  await supabaseDelete(c.env, 'annuaire_responsables', { id: `eq.${ligne.id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// POST /:id/responsables/quitter — l'habitant se retire (ou annule sa demande) depuis la fiche,
// sans avoir besoin de l'id de sa ligne.
app.post('/:id/responsables/quitter', async (c) => {
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'annuaire_responsables', {
    commune_id: `eq.${commune_id}`, fiche_id: `eq.${c.req.param('id')}`, user_id: `eq.${c.get('user_id')}`,
  });
  return c.json({ ok: true });
});

// POST /logo-upload — image du logo (association, commerce...), avant création/modification
// d'une fiche. Mêmes formats/limite que le logo de la commune (worker/src/routes/commune.ts).
app.post('/logo-upload', async (c) => {
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    return c.json({ erreur: 'Format non autorisé (JPEG, PNG ou WebP uniquement)' }, 400);
  }

  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 8 * 1024 * 1024) {
    return c.json({ erreur: 'Image trop lourde (8 Mo maximum)' }, 400);
  }

  const extension = contentType.split('/')[1];
  const key = `${commune_id}/annuaire/logos/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

// POST /document-upload — pièce jointe d'une fiche (statuts, plaquette, photos...). PDF et
// images acceptés, comme le PV de conseil (worker/src/routes/actus.ts, /pv-upload).
app.post('/document-upload', async (c) => {
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  const typesAutorises = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!typesAutorises.includes(contentType)) {
    return c.json({ erreur: 'Seuls les fichiers PDF, JPEG, PNG et WebP sont acceptés' }, 400);
  }

  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 15 * 1024 * 1024) {
    return c.json({ erreur: 'Fichier trop volumineux (15 Mo maximum)' }, 400);
  }

  const extension = contentType.split('/')[1];
  const key = `${commune_id}/annuaire/documents/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  const type = contentType === 'application/pdf' ? 'pdf' : 'image';
  return c.json({ key, url, type });
});

export default app;

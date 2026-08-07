// worker/src/routes/annuaire.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';

const app = new Hono();
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
  telephone: z.string().max(30).optional(),
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

  const result = fiches.map((f: any) => ({
    ...f,
    documents: documents.filter((d: any) => d.fiche_id === f.id),
  }));

  return c.json({ fiches: result });
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
  if (fiche.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  const body = creationSchema.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à modifier' }, 400);

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

  await supabaseUpdate(c.env, 'annuaire', patch, { id: `eq.${fiche_id}`, commune_id: `eq.${commune_id}` });
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

  const documents = await supabaseSelect(c.env, 'annuaire_documents', {
    select: 'r2_key', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}`,
  });
  await Promise.all([
    ...(fiche.logo_r2_key ? [deleteObject(c.env, fiche.logo_r2_key)] : []),
    ...documents.map((d: any) => deleteObject(c.env, d.r2_key)),
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
  if (fiche.user_id !== user_id && !estGestionnaire(role)) {
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

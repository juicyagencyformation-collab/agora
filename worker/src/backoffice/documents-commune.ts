// worker/src/backoffice/documents-commune.ts
// Dossier documentaire d'une commune (étape 4b du remaniement, 2026-11-04) : documents signés
// archivés dans l'onglet Dossier de la fiche (convention, DPA, délibération, bon de commande...).
// ⚠️ Stockage dans un bucket R2 PRIVÉ séparé (binding BUCKET_DOCUMENTS = agora-documents-eu, sans
// domaine public ni adresse r2.dev) : agora-uploads-eu est entièrement lisible via
// cdn.plateforme-agora.fr, un contrat signé ne doit jamais y aller. Le téléchargement passe par ce
// Worker, derrière la session staff, et n'est jamais mis en cache.
import { Hono } from 'hono';
import { z } from 'zod';
import { backofficeMiddleware, exigerAdmin } from '../middleware/backoffice';
import { supabaseSelect, supabaseInsert, supabaseDelete, journaliser } from '../db';

const app = new Hono();
app.use('*', backofficeMiddleware);

export const TYPES_DOCUMENT = {
  convention: 'Convention signée',
  dpa: 'Contrat DPA signé',
  deliberation: 'Délibération',
  bon_commande: 'Bon de commande',
  attestation_assurance: 'Attestation d’assurance',
  devis_signe: 'Devis signé',
  autre: 'Autre document',
} as const;
const EXTENSIONS: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const TAILLE_MAX = 10 * 1024 * 1024;
const COLONNES = 'id,commune_id,type,libelle,signe_le,nom_fichier,content_type,taille_octets,depose_par,created_at';

const metadonneesSchema = z.object({
  type: z.enum(Object.keys(TYPES_DOCUMENT) as [keyof typeof TYPES_DOCUMENT, ...(keyof typeof TYPES_DOCUMENT)[]]),
  libelle: z.string().trim().max(150).optional(),
  signe_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const stockageAbsent = (c: any) => !c.env.BUCKET_DOCUMENTS
  && c.json({ erreur: 'Le stockage privé des documents n’est pas encore configuré (bucket agora-documents-eu).' }, 503);

app.get('/communes/:id', async (c) => {
  // Tolérant tant que la migration 095 n'est pas passée : liste vide, mais les types restent
  // disponibles pour le formulaire.
  const documents = await supabaseSelect(c.env, 'documents_commune', {
    select: COLONNES, commune_id: `eq.${c.req.param('id')}`, order: 'created_at.desc',
  }).catch(() => []);
  return c.json({ documents, types: TYPES_DOCUMENT });
});

app.post('/communes/:id', async (c) => {
  const absent = stockageAbsent(c);
  if (absent) return absent;
  const communeId = c.req.param('id');
  const formulaire = await c.req.formData().catch(() => null);
  if (!formulaire) return c.json({ erreur: 'Formulaire invalide' }, 400);

  const meta = metadonneesSchema.safeParse({
    type: formulaire.get('type'),
    libelle: formulaire.get('libelle') || undefined,
    signe_le: formulaire.get('signe_le') || undefined,
  });
  if (!meta.success) return c.json({ erreur: 'Type de document ou date invalide' }, 400);

  const fichier = formulaire.get('fichier');
  if (!(fichier instanceof File)) return c.json({ erreur: 'Aucun fichier' }, 400);
  const extension = EXTENSIONS[fichier.type];
  if (!extension) return c.json({ erreur: 'Format accepté : PDF, JPEG ou PNG' }, 400);
  if (fichier.size > TAILLE_MAX) return c.json({ erreur: 'Fichier trop lourd (10 Mo maximum)' }, 400);

  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'id,nom', id: `eq.${communeId}` });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  const r2_key = `${communeId}/${crypto.randomUUID()}.${extension}`;
  await c.env.BUCKET_DOCUMENTS.put(r2_key, await fichier.arrayBuffer(), { httpMetadata: { contentType: fichier.type } });
  try {
    const [document] = await supabaseInsert(c.env, 'documents_commune', {
      commune_id: communeId, type: meta.data.type, libelle: meta.data.libelle || null, signe_le: meta.data.signe_le || null,
      r2_key, nom_fichier: fichier.name.slice(0, 200) || `document.${extension}`, content_type: fichier.type,
      taille_octets: fichier.size, depose_par: c.get('staff_id'),
    });
    await journaliser(c.env, c.get('staff_id'), 'document_depose', `${commune.nom} : ${TYPES_DOCUMENT[meta.data.type]}`);
    return c.json({ ok: true, id: document.id }, 201);
  } catch (e) {
    // Jamais de fichier orphelin dans le bucket si l'enregistrement en base échoue.
    await c.env.BUCKET_DOCUMENTS.delete(r2_key);
    throw e;
  }
});

app.get('/:docId/fichier', async (c) => {
  const absent = stockageAbsent(c);
  if (absent) return absent;
  const [document] = await supabaseSelect(c.env, 'documents_commune', {
    select: 'r2_key,nom_fichier,content_type', id: `eq.${c.req.param('docId')}`,
  });
  if (!document) return c.json({ erreur: 'Document introuvable' }, 404);
  const objet = await c.env.BUCKET_DOCUMENTS.get(document.r2_key);
  if (!objet) return c.json({ erreur: 'Fichier introuvable dans le stockage' }, 404);
  const nom = document.nom_fichier.replace(/["\\\r\n]/g, '_');
  // ?affichage=1 : ouvert dans le navigateur pour l'imprimer (dossier papier) plutôt que téléchargé.
  // Sans risque d'exécution : seuls PDF/JPEG/PNG sont acceptés au dépôt, servis avec leur type exact
  // et nosniff.
  const disposition = c.req.query('affichage') === '1' ? 'inline' : 'attachment';
  return new Response(objet.body, {
    headers: {
      'Content-Type': document.content_type,
      'Content-Disposition': `${disposition}; filename="${nom}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// Supprimer un document signé : réservé au compte administrateur (une archive ne disparaît pas
// sur une fausse manœuvre d'assistant).
app.delete('/:docId', exigerAdmin, async (c) => {
  const absent = stockageAbsent(c);
  if (absent) return absent;
  const [document] = await supabaseSelect(c.env, 'documents_commune', {
    select: 'id,r2_key,type,commune_id', id: `eq.${c.req.param('docId')}`,
  });
  if (!document) return c.json({ erreur: 'Document introuvable' }, 404);
  await c.env.BUCKET_DOCUMENTS.delete(document.r2_key);
  await supabaseDelete(c.env, 'documents_commune', { id: `eq.${document.id}` });
  await journaliser(c.env, c.get('staff_id'), 'document_supprime', `${document.commune_id} : ${TYPES_DOCUMENT[document.type as keyof typeof TYPES_DOCUMENT] ?? document.type}`);
  return c.json({ ok: true });
});

export default app;

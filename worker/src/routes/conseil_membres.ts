// worker/src/routes/conseil_membres.ts
import { peutGererRoles } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';

const app = new Hono();
app.use('*', jwtMiddleware);

// Composition du conseil = information officielle : réservée aux élus / au maire (comme le
// reste du module conseil), pas aux admins. La lecture reste ouverte à tout citoyen connecté.
function peutGererConseil(role: string) {
  return peutGererRoles(role);
}

const membreSchema = z.object({
  nom: z.string().min(1).max(100),
  prenom: z.string().min(1).max(100),
  fonction: z.string().max(120).optional(),
  profession: z.string().max(120).optional(),
  contact: z.string().max(300).optional(),
  photo_r2_key: z.string().optional(),
  ordre: z.number().int().min(0).max(9999).optional(),
});

function champsMembre(env: any, data: z.infer<typeof membreSchema>) {
  return {
    nom: data.nom, prenom: data.prenom,
    fonction: data.fonction?.trim() || null,
    profession: data.profession?.trim() || null,
    contact: data.contact?.trim() || null,
    photo_r2_key: data.photo_r2_key ?? null,
    photo_url: data.photo_r2_key ? `${env.R2_PUBLIC_BASE}/${data.photo_r2_key}` : null,
    ordre: data.ordre ?? 0,
  };
}

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const membres = await supabaseSelect(c.env, 'conseil_membres', {
    select: 'id,nom,prenom,fonction,profession,contact,photo_url,ordre',
    commune_id: `eq.${commune_id}`, order: 'ordre.asc,nom.asc',
  });
  return c.json({ membres });
});

app.post('/', async (c) => {
  if (!peutGererConseil(c.get('role'))) return c.json({ erreur: 'Réservé aux élus et au maire' }, 403);
  const commune_id = c.get('commune_id');

  const body = membreSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [membre] = await supabaseInsert(c.env, 'conseil_membres', { commune_id, ...champsMembre(c.env, body.data) });
  return c.json({ membre_id: membre.id }, 201);
});

app.patch('/:id', async (c) => {
  if (!peutGererConseil(c.get('role'))) return c.json({ erreur: 'Réservé aux élus et au maire' }, 403);
  const commune_id = c.get('commune_id');
  const membre_id = c.req.param('id');

  const [membre] = await supabaseSelect(c.env, 'conseil_membres', {
    select: 'id,photo_r2_key', commune_id: `eq.${commune_id}`, id: `eq.${membre_id}`,
  });
  if (!membre) return c.json({ erreur: 'Membre introuvable' }, 404);

  const body = membreSchema.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à modifier' }, 400);

  const patch: Record<string, unknown> = {};
  const d = body.data;
  if (d.nom !== undefined) patch.nom = d.nom;
  if (d.prenom !== undefined) patch.prenom = d.prenom;
  if (d.fonction !== undefined) patch.fonction = d.fonction.trim() || null;
  if (d.profession !== undefined) patch.profession = d.profession.trim() || null;
  if (d.contact !== undefined) patch.contact = d.contact.trim() || null;
  if (d.ordre !== undefined) patch.ordre = d.ordre;
  if (d.photo_r2_key !== undefined) {
    patch.photo_r2_key = d.photo_r2_key || null;
    patch.photo_url = d.photo_r2_key ? `${c.env.R2_PUBLIC_BASE}/${d.photo_r2_key}` : null;
    if (membre.photo_r2_key && membre.photo_r2_key !== d.photo_r2_key) {
      await deleteObject(c.env, membre.photo_r2_key);
    }
  }

  await supabaseUpdate(c.env, 'conseil_membres', patch, { id: `eq.${membre_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  if (!peutGererConseil(c.get('role'))) return c.json({ erreur: 'Réservé aux élus et au maire' }, 403);
  const commune_id = c.get('commune_id');
  const membre_id = c.req.param('id');

  const [membre] = await supabaseSelect(c.env, 'conseil_membres', {
    select: 'id,photo_r2_key', commune_id: `eq.${commune_id}`, id: `eq.${membre_id}`,
  });
  if (!membre) return c.json({ erreur: 'Membre introuvable' }, 404);

  if (membre.photo_r2_key) await deleteObject(c.env, membre.photo_r2_key);
  await supabaseDelete(c.env, 'conseil_membres', { id: `eq.${membre_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// POST /photo-upload — photo d'un membre (avant création/édition). Image uniquement.
app.post('/photo-upload', async (c) => {
  if (!peutGererConseil(c.get('role'))) return c.json({ erreur: 'Réservé aux élus et au maire' }, 403);
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
  const key = `${commune_id}/conseil/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

export default app;

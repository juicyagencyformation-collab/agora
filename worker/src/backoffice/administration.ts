// worker/src/backoffice/administration.ts
// Administration/suivi des communes clientes (Phase 1 du backoffice). Toutes les routes sont
// derrière backofficeMiddleware : accès staff transverse, pas de commune_id dans le jeton.
// On lit directement les tables existantes (communes, users, avis_application) et on calcule
// le stockage R2 réellement consommé par commune via le préfixe de clé `${commune_id}/`.
import { Hono } from 'hono';
import { supabaseSelect } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';

const app = new Hono();
app.use('*', backofficeMiddleware);

// Somme des octets stockés dans R2 sous le préfixe d'une commune. Toutes les clés d'upload du
// projet sont préfixées `${commune_id}/...` (voir storage.ts et les routes d'upload), donc un
// simple list préfixé donne la consommation exacte. On boucle sur le curseur car list() est
// paginé (1000 objets max par page).
async function calculerStockageR2(env: any, commune_id: string): Promise<{ octets: number; nb_fichiers: number }> {
  if (!env.BUCKET_R2) return { octets: 0, nb_fichiers: 0 };
  let octets = 0;
  let nb_fichiers = 0;
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET_R2.list({ prefix: `${commune_id}/`, cursor });
    for (const objet of page.objects) {
      octets += objet.size;
      nb_fichiers += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { octets, nb_fichiers };
}

// GET /communes — liste des communes clientes avec quelques indicateurs de suivi.
// La commune "nationale" (niveau_national=true) n'est pas une cliente : on l'exclut.
app.get('/communes', async (c) => {
  const communes = await supabaseSelect(c.env, 'communes', {
    select: 'id,slug,nom,population,logo_url,contact_email,created_at',
    niveau_national: 'eq.false',
    order: 'nom.asc',
  });

  // Deux lectures légères agrégées côté Worker plutôt qu'une requête par commune (N+1).
  const users = await supabaseSelect(c.env, 'users', { select: 'commune_id' });
  const avis = await supabaseSelect(c.env, 'avis_application', { select: 'commune_id,note' });

  const nbCitoyens = new Map<string, number>();
  for (const u of users) nbCitoyens.set(u.commune_id, (nbCitoyens.get(u.commune_id) ?? 0) + 1);

  const cumulAvis = new Map<string, { total: number; n: number }>();
  for (const a of avis) {
    const e = cumulAvis.get(a.commune_id) ?? { total: 0, n: 0 };
    e.total += a.note; e.n += 1;
    cumulAvis.set(a.commune_id, e);
  }

  const liste = communes.map((commune: any) => {
    const av = cumulAvis.get(commune.id);
    return {
      ...commune,
      nb_citoyens: nbCitoyens.get(commune.id) ?? 0,
      note_moyenne: av ? Math.round((av.total / av.n) * 10) / 10 : null,
      nb_avis: av ? av.n : 0,
    };
  });

  return c.json({ communes: liste });
});

// GET /communes/:id — fiche détaillée d'une commune cliente.
app.get('/communes/:id', async (c) => {
  const id = c.req.param('id');

  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'id,slug,nom,population,logo_url,contact_email,telephone_mairie,email_mairie,created_at',
    id: `eq.${id}`,
  });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  const [membres, avis, stockage] = await Promise.all([
    supabaseSelect(c.env, 'users', { select: 'role', commune_id: `eq.${id}` }),
    supabaseSelect(c.env, 'avis_application', {
      select: 'note,commentaire,created_at', commune_id: `eq.${id}`, order: 'created_at.desc',
    }),
    calculerStockageR2(c.env, id),
  ]);

  const parRole: Record<string, number> = {};
  for (const m of membres) parRole[m.role] = (parRole[m.role] ?? 0) + 1;

  const note_moyenne = avis.length
    ? Math.round((avis.reduce((s: number, a: any) => s + a.note, 0) / avis.length) * 10) / 10
    : null;

  return c.json({
    commune,
    citoyens: { total: membres.length, par_role: parRole },
    avis: { note_moyenne, nb: avis.length, liste: avis },
    stockage,
  });
});

// GET /apercu — indicateurs globaux pour la page d'accueil du backoffice.
app.get('/apercu', async (c) => {
  const communes = await supabaseSelect(c.env, 'communes', {
    select: 'id', niveau_national: 'eq.false',
  });
  const users = await supabaseSelect(c.env, 'users', { select: 'id' });
  const avis = await supabaseSelect(c.env, 'avis_application', { select: 'note' });

  const note_moyenne = avis.length
    ? Math.round((avis.reduce((s: number, a: any) => s + a.note, 0) / avis.length) * 10) / 10
    : null;

  return c.json({
    nb_communes: communes.length,
    nb_citoyens: users.length,
    note_moyenne,
    nb_avis: avis.length,
  });
});

export default app;

// worker/src/backoffice/annonces-plateforme.ts
// Onglet « 📣 Annonces » du backoffice : informer les habitants des nouveautés, d'une maintenance
// ou d'une astuce ("Le saviez-vous ?"), en bandeau sur l'accueil de l'app (voir
// routes/annonces_plateforme.ts pour l'affichage et migration 087 pour le schéma).
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseSelectTout, supabaseInsert, supabaseDelete, journaliser } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { REGIONS, regionDuDepartement } from '../lib/regions';

const app = new Hono();
app.use('*', backofficeMiddleware);

const DUREE_MAX_JOURS = 180;

const creationSchema = z.object({
  type: z.enum(['astuce', 'nouveaute', 'info', 'maintenance']),
  texte: z.string().trim().min(1).max(300),
  action: z.enum(['aucune', 'partager', 'avis']).default('aucune'),
  cible: z.enum(['toutes', 'communes', 'regions']),
  communes_ids: z.array(z.string().uuid()).max(500).default([]),
  regions: z.array(z.enum(REGIONS as [string, ...string[]])).default([]),
  destinataires: z.enum(['tous', 'gestionnaires']).default('tous'),
  fin_le: z.string().datetime({ offset: true }),
}).superRefine((d, ctx) => {
  if (d.cible === 'communes' && !d.communes_ids.length) ctx.addIssue({ code: 'custom', message: 'Choisis au moins une commune.' });
  if (d.cible === 'regions' && !d.regions.length) ctx.addIssue({ code: 'custom', message: 'Choisis au moins une région.' });
});

// GET /annonces-plateforme — les 100 dernières annonces, avec le nombre d'habitants qui l'ont lue.
app.get('/', async (c) => {
  const annonces = await supabaseSelect(c.env, 'annonces_plateforme', {
    select: 'id,type,texte,action,cible,communes_ids,regions,destinataires,debut_le,fin_le,created_at',
    order: 'created_at.desc', limit: '100',
  });
  const lues = annonces.length ? await supabaseSelectTout(c.env, 'annonces_plateforme_lues', {
    select: 'annonce_id', annonce_id: `in.(${annonces.map((a: any) => a.id).join(',')})`, order: 'id.asc',
  }) : [];
  const nbLues = new Map<string, number>();
  for (const l of lues) nbLues.set(l.annonce_id, (nbLues.get(l.annonce_id) ?? 0) + 1);
  return c.json({ annonces: annonces.map((a: any) => ({ ...a, nb_lues: nbLues.get(a.id) ?? 0 })) });
});

// GET /annonces-plateforme/cibles — uniquement les communes avec de vrais utilisateurs (ou un
// forfait payant), même règle que le tableau « Communes clientes » : inutile de cibler les
// 14 000+ communes activées par la prospection sans aucune inscription.
app.get('/cibles', async (c) => {
  const [comptes, payantes] = await Promise.all([
    supabaseSelectTout(c.env, 'users', {
      select: 'commune_id', role: 'in.(citoyen,admin,elu)', compte_supprime_le: 'is.null', compte_provisionne: 'neq.true', order: 'id.asc',
    }),
    // neq.Gratuit exclut aussi les forfaits vides (NULL) côté SQL.
    supabaseSelect(c.env, 'communes', { select: 'id', forfait: 'neq.Gratuit' }),
  ]);
  const ids = [...new Set([...comptes.map((u: any) => u.commune_id), ...payantes.map((p: any) => p.id)].filter(Boolean))];
  const toutes = ids.length ? await supabaseSelect(c.env, 'communes', {
    select: 'id,nom,departement', id: `in.(${ids.join(',')})`, niveau_national: 'not.is.true',
  }) : [];
  const sansDep = toutes.filter((x: any) => !x.departement).map((x: any) => x.id);
  const prospects = sansDep.length ? await supabaseSelect(c.env, 'prospects', {
    select: 'commune_id,departement', commune_id: `in.(${sansDep.join(',')})`,
  }) : [];
  const liste = toutes.map((x: any) => ({
    id: x.id, nom: x.nom,
    region: regionDuDepartement(x.departement ?? prospects.find((p: any) => p.commune_id === x.id)?.departement),
  })).sort((a: any, b: any) => a.nom.localeCompare(b.nom, 'fr'));
  const regions = [...new Set(liste.map((x: any) => x.region).filter(Boolean))].sort((a: any, b: any) => a.localeCompare(b, 'fr'));
  return c.json({ communes: liste, regions });
});

app.post('/', async (c) => {
  const body = creationSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    const message = body.error.issues.find((i) => i.code === 'custom')?.message;
    return c.json({ erreur: message ?? body.error.flatten() }, 400);
  }
  const d = body.data;
  const fin = new Date(d.fin_le).getTime();
  if (fin <= Date.now()) return c.json({ erreur: 'La date de fin doit être dans le futur.' }, 400);
  if (fin > Date.now() + DUREE_MAX_JOURS * 86400000) return c.json({ erreur: `Une annonce dure au plus ${DUREE_MAX_JOURS} jours.` }, 400);

  const [annonce] = await supabaseInsert(c.env, 'annonces_plateforme', {
    type: d.type, texte: d.texte, action: d.action, cible: d.cible,
    communes_ids: d.cible === 'communes' ? d.communes_ids : [],
    regions: d.cible === 'regions' ? d.regions : [],
    destinataires: d.destinataires, fin_le: new Date(d.fin_le).toISOString(), cree_par: c.get('staff_id') ?? null,
  });
  const portee = d.cible === 'toutes' ? 'toutes les communes' : d.cible === 'communes' ? `${d.communes_ids.length} commune(s)` : d.regions.join(', ');
  await journaliser(c.env, c.get('staff_id'), 'annonce_plateforme_publiee', `${d.type} → ${portee} : ${d.texte.slice(0, 80)}`);
  return c.json({ annonce }, 201);
});

app.delete('/:id', async (c) => {
  const id = z.string().uuid().safeParse(c.req.param('id'));
  if (!id.success) return c.json({ erreur: 'Annonce invalide' }, 400);
  await supabaseDelete(c.env, 'annonces_plateforme', { id: `eq.${id.data}` });
  await journaliser(c.env, c.get('staff_id'), 'annonce_plateforme_retiree', id.data);
  return c.json({ ok: true });
});

export default app;

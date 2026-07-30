// worker/src/routes/deliberations.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';

const app = new Hono();
app.use('*', jwtMiddleware);

const creationSchema = z.object({
  titre: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  closes_at: z.string().datetime().optional(),
});

// GET / — les résultats détaillés restent masqués tant que non "publiée" (résultats publiés par la mairie)
app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const deliberations = await supabaseSelect(c.env, 'deliberations', {
    select: 'id,titre,description,statut,closes_at,created_at',
    commune_id: `eq.${commune_id}`,
    order: 'created_at.desc',
  });
  const ids = deliberations.map((d: any) => d.id);
  const votes = ids.length ? await supabaseSelect(c.env, 'votes_deliberation', {
    select: 'deliberation_id,choix,user_id',
    commune_id: `eq.${commune_id}`,
    deliberation_id: `in.(${ids.join(',')})`,
  }) : [];

  const result = deliberations.map((d: any) => {
    const votesDelib = votes.filter((v: any) => v.deliberation_id === d.id);
    const monVote = votesDelib.find((v: any) => v.user_id === user_id)?.choix ?? null;
    const base = {
      ...d,
      total_votes: votesDelib.length,
      mon_vote: monVote,
      cloturee: d.closes_at ? new Date(d.closes_at) < new Date() : false,
    };
    if (d.statut === 'publiee') {
      return {
        ...base,
        resultats: {
          pour: votesDelib.filter((v: any) => v.choix === 'pour').length,
          contre: votesDelib.filter((v: any) => v.choix === 'contre').length,
          abstention: votesDelib.filter((v: any) => v.choix === 'abstention').length,
        },
      };
    }
    return base;
  });

  return c.json({ deliberations: result });
});

app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [d] = await supabaseInsert(c.env, 'deliberations', {
    commune_id, titre: body.data.titre, description: body.data.description,
    statut: 'ouverte', closes_at: body.data.closes_at ?? null,
  });
  return c.json({ deliberation_id: d.id }, 201);
});

app.post('/:id/vote', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const deliberation_id = c.req.param('id');

  const schema = z.object({ choix: z.enum(['pour', 'contre', 'abstention']) });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [d] = await supabaseSelect(c.env, 'deliberations', {
    select: 'id,statut,closes_at', commune_id: `eq.${commune_id}`, id: `eq.${deliberation_id}`,
  });
  if (!d) return c.json({ erreur: 'Délibération introuvable' }, 404);
  if (d.statut === 'publiee') return c.json({ erreur: 'Le vote est clos, résultats déjà publiés' }, 400);
  if (d.closes_at && new Date(d.closes_at) < new Date()) return c.json({ erreur: 'Le vote est clos' }, 400);

  const [existant] = await supabaseSelect(c.env, 'votes_deliberation', {
    select: 'id', commune_id: `eq.${commune_id}`, deliberation_id: `eq.${deliberation_id}`, user_id: `eq.${user_id}`,
  });
  if (existant) {
    await supabaseUpdate(c.env, 'votes_deliberation', { choix: body.data.choix }, { id: `eq.${existant.id}` });
  } else {
    await supabaseInsert(c.env, 'votes_deliberation', { commune_id, deliberation_id, user_id, choix: body.data.choix });
  }
  return c.json({ ok: true });
});

app.patch('/:id/publier', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseUpdate(c.env, 'deliberations', { statut: 'publiee' }, {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'deliberations', { id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// Export imprimable des résultats (déclaré publié uniquement) — "Enregistrer en PDF" via le navigateur,
// plus simple et plus fiable qu'un générateur binaire PDF fait main.
app.get('/:id/export', async (c) => {
  const commune_id = c.get('commune_id');
  const [d] = await supabaseSelect(c.env, 'deliberations', {
    select: 'titre,description,statut,created_at', commune_id: `eq.${commune_id}`, id: `eq.${c.req.param('id')}`,
  });
  if (!d || d.statut !== 'publiee') return c.json({ erreur: 'Résultats non publiés' }, 404);

  const votes = await supabaseSelect(c.env, 'votes_deliberation', {
    select: 'choix', commune_id: `eq.${commune_id}`, deliberation_id: `eq.${c.req.param('id')}`,
  });
  const pour = votes.filter((v: any) => v.choix === 'pour').length;
  const contre = votes.filter((v: any) => v.choix === 'contre').length;
  const abstention = votes.filter((v: any) => v.choix === 'abstention').length;

  return c.html(`
    <html><head><meta charset="UTF-8"><title>${d.titre}</title>
    <style>body{font-family:sans-serif;max-width:700px;margin:40px auto;line-height:1.6;padding:0 20px;}
    h1{font-size:22px;} .resultat{font-size:18px;margin:6px 0;} @media print{button{display:none;}}</style>
    </head><body>
    <h1>${d.titre}</h1>
    <p>${d.description.replace(/\n/g, '<br>')}</p>
    <hr>
    <p class="resultat">✅ Pour : <strong>${pour}</strong></p>
    <p class="resultat">❌ Contre : <strong>${contre}</strong></p>
    <p class="resultat">➖ Abstention : <strong>${abstention}</strong></p>
    <p><small>Délibéré le ${new Date(d.created_at).toLocaleDateString('fr-FR')}</small></p>
    <button onclick="window.print()">Imprimer / Enregistrer en PDF</button>
    </body></html>
  `);
});

export default app;

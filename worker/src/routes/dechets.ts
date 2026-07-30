// worker/src/routes/dechets.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseInsert, supabaseUpdate, supabaseDelete } from '../db';

const app = new Hono();
app.use('*', jwtMiddleware);

const TYPES_VALIDES = ['ordures_menageres', 'tri_selectif', 'verre', 'encombrants', 'dechets_verts'] as const;

function numeroSemaineISO(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const jourSemaine = d.getUTCDay() || 7; // dimanche devient 7
  d.setUTCDate(d.getUTCDate() + 4 - jourSemaine);
  const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - debutAnnee.getTime()) / 86400000 + 1) / 7);
}

function frequenceCorrespond(date: Date, frequence: string): boolean {
  if (frequence === 'chaque_semaine') return true;
  const paire = numeroSemaineISO(date) % 2 === 0;
  return frequence === 'semaines_paires' ? paire : !paire;
}

// Retourne la prochaine date (incluant aujourd'hui) correspondant au jour+fréquence donnés
function prochaineDateCollecte(jourSemaine: number, frequence: string): Date {
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  for (let i = 0; i < 21; i++) { // recherche sur 3 semaines max
    const candidate = new Date(aujourdhui);
    candidate.setDate(candidate.getDate() + i);
    const jourCandidate = candidate.getDay() || 7;
    if (jourCandidate === jourSemaine && frequenceCorrespond(candidate, frequence)) {
      return candidate;
    }
  }
  return aujourdhui; // ne devrait jamais arriver
}

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const configs = await supabaseSelect(c.env, 'dechets_config', {
    select: 'id,type,jour_semaine,frequence,couleur',
    commune_id: `eq.${commune_id}`,
  });

  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);

  const result = configs.map((cfg: any) => {
    const prochaine = prochaineDateCollecte(cfg.jour_semaine, cfg.frequence);
    const estAujourdhui = prochaine.getTime() === aujourdhui.getTime();
    return {
      ...cfg,
      prochaine_date: prochaine.toISOString().slice(0, 10),
      aujourdhui: estAujourdhui,
      dans_jours: Math.round((prochaine.getTime() - aujourdhui.getTime()) / 86400000),
    };
  }).sort((a: any, b: any) => a.dans_jours - b.dans_jours);

  return c.json({ collectes: result });
});

const configSchema = z.object({
  type: z.enum(TYPES_VALIDES),
  jour_semaine: z.number().int().min(1).max(7),
  frequence: z.enum(['chaque_semaine', 'semaines_paires', 'semaines_impaires']),
  couleur: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

// POST : upsert (un type = une seule ligne par commune)
app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');

  const body = configSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [existant] = await supabaseSelect(c.env, 'dechets_config', {
    select: 'id',
    commune_id: `eq.${commune_id}`, type: `eq.${data.type}`,
  });

  if (existant) {
    await supabaseUpdate(c.env, 'dechets_config', {
      jour_semaine: data.jour_semaine, frequence: data.frequence,
      couleur: data.couleur ?? '#8B7355',
    }, { id: `eq.${existant.id}` });
  } else {
    await supabaseInsert(c.env, 'dechets_config', {
      commune_id, type: data.type, jour_semaine: data.jour_semaine,
      frequence: data.frequence, couleur: data.couleur ?? '#8B7355',
    });
  }

  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'dechets_config', {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

export default app;

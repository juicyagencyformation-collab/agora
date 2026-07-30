// worker/src/routes/chasses_tresor.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseDelete, supabaseSelect } from '../db';
import { genererQrSvg } from '../lib/qrcode';
import { attribuerXp, XP_ACTIONS, incrementerCompteurUtilisateur, gererStreakExploration } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';

const app = new Hono();
app.use('*', jwtMiddleware);

const etapeSchema = z.object({
  titre: z.string().min(1).max(150),
  indice: z.string().min(1).max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const creationChasseSchema = z.object({
  titre: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  etapes: z.array(etapeSchema).min(1).max(20),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const chasses = await supabaseSelect(c.env, 'chasses_tresor', {
    select: 'id,titre,description,actif,created_at',
    commune_id: `eq.${commune_id}`,
    actif: 'eq.true',
    order: 'created_at.desc',
  });
  const ids = chasses.map((ch: any) => ch.id);
  if (!ids.length) return c.json({ chasses: [] });

  const [etapes, progressions] = await Promise.all([
    supabaseSelect(c.env, 'etapes_chasse', {
      select: 'id,chasse_id,ordre,titre,indice,lat,lng',
      commune_id: `eq.${commune_id}`,
      chasse_id: `in.(${ids.join(',')})`,
      order: 'ordre.asc',
    }),
    supabaseSelect(c.env, 'progressions_chasse', {
      select: 'chasse_id,etape_id,user_id,validee_at',
      commune_id: `eq.${commune_id}`,
      chasse_id: `in.(${ids.join(',')})`,
      user_id: `eq.${user_id}`,
    }),
  ]);

  const result = chasses.map((ch: any) => {
    const etapesChasse = etapes.filter((e: any) => e.chasse_id === ch.id);
    const etapesValidees = progressions.filter((p: any) => p.chasse_id === ch.id).map((p: any) => p.etape_id);
    return {
      ...ch,
      total_etapes: etapesChasse.length,
      etapes_validees: etapesValidees.length,
      etape_suivante: etapesChasse.find((e: any) => !etapesValidees.includes(e.id)) ?? null,
    };
  });

  return c.json({ chasses: result });
});

app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationChasseSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const [chasse] = await supabaseInsert(c.env, 'chasses_tresor', {
    commune_id, user_id, titre: data.titre, description: data.description ?? null, actif: true,
  });

  await supabaseInsert(c.env, 'etapes_chasse', data.etapes.map((e, i) => ({
    commune_id, chasse_id: chasse.id, ordre: i, titre: e.titre, indice: e.indice,
    lat: e.lat, lng: e.lng, qr_token: crypto.randomUUID(),
  })));

  c.executionCtx.waitUntil((async () => {
    const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_chasses');
    await envoyerNotificationAUtilisateurs(
      c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
      '🗺️ Nouvelle chasse au trésor', data.titre, `/index.html?onglet=chasse-tresor&type=chasse&id=${chasse.id}`,
    );
  })());

  return c.json({ chasse_id: chasse.id }, 201);
});

// GET /:id/etapes — liste des étapes avec leurs identifiants (gestionnaire, pour générer/imprimer les QR)
app.get('/:id/etapes', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const etapes = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id,ordre,titre,indice',
    commune_id: `eq.${commune_id}`, chasse_id: `eq.${c.req.param('id')}`,
    order: 'ordre.asc',
  });
  return c.json({ etapes });
});

app.get('/:id/etapes/:etapeId/qr-page', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'qr_token',
    commune_id: `eq.${commune_id}`, id: `eq.${c.req.param('etapeId')}`,
  });
  if (!etape) return c.json({ erreur: 'Étape introuvable' }, 404);

  const svg = genererQrSvg(etape.qr_token);
  return c.html(`<div>${svg}<p style="font-family:monospace">${etape.qr_token}</p></div>`);
});

app.post('/valider', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const schema = z.object({ qr_token: z.string().uuid() });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [etape] = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id,chasse_id,ordre',
    commune_id: `eq.${commune_id}`, qr_token: `eq.${body.data.qr_token}`,
  });
  if (!etape) return c.json({ erreur: 'QR code invalide' }, 404);

  if (etape.ordre > 0) {
    const etapesPrecedentes = await supabaseSelect(c.env, 'etapes_chasse', {
      select: 'id',
      commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, ordre: `lt.${etape.ordre}`,
    });
    const progressions = await supabaseSelect(c.env, 'progressions_chasse', {
      select: 'etape_id',
      commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, user_id: `eq.${user_id}`,
    });
    const idsValides = progressions.map((p: any) => p.etape_id);
    const toutesValidees = etapesPrecedentes.every((e: any) => idsValides.includes(e.id));
    if (!toutesValidees) return c.json({ erreur: 'Étapes précédentes non validées' }, 400);
  }

  const [dejaValidee] = await supabaseSelect(c.env, 'progressions_chasse', {
    select: 'id',
    commune_id: `eq.${commune_id}`, etape_id: `eq.${etape.id}`, user_id: `eq.${user_id}`,
  });
  if (dejaValidee) return c.json({ erreur: 'Étape déjà validée' }, 400);

  await supabaseInsert(c.env, 'progressions_chasse', {
    commune_id, chasse_id: etape.chasse_id, etape_id: etape.id, user_id, validee_at: new Date().toISOString(),
  });

  await incrementerCompteurUtilisateur(c.env, commune_id, user_id, 'etapes_chasse_validees');

  // Détecte la complétion à 100% de CETTE chasse (badge "Finisseur", distinct du simple cumul).
  const toutesEtapesChasse = await supabaseSelect(c.env, 'etapes_chasse', {
    select: 'id', commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`,
  });
  const mesProgressionsChasse = await supabaseSelect(c.env, 'progressions_chasse', {
    select: 'id', commune_id: `eq.${commune_id}`, chasse_id: `eq.${etape.chasse_id}`, user_id: `eq.${user_id}`,
  });
  if (mesProgressionsChasse.length >= toutesEtapesChasse.length) {
    await incrementerCompteurUtilisateur(c.env, commune_id, user_id, 'chasses_terminees');
  }

  await gererStreakExploration(c.env, commune_id, user_id);
  const resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.valider_etape_chasse);

  return c.json({ ok: true, xp_gagne: resultatXp.xp_gagne, nouveaux_badges: resultatXp.nouveaux_badges });
});

// GET /classement-exploration — score combiné (étapes de chasse validées + énigmes trouvées),
// affiché depuis l'onglet fusionné Chasse au trésor / Trouve la photo.
app.get('/classement-exploration', async (c) => {
  const commune_id = c.get('commune_id');
  const users = await supabaseSelect(c.env, 'users', {
    select: 'prenom,etapes_chasse_validees,enigmes_trouvees',
    commune_id: `eq.${commune_id}`,
  });

  const classement = users
    .map((u: any) => ({
      prenom: u.prenom,
      etapes: u.etapes_chasse_validees ?? 0,
      enigmes: u.enigmes_trouvees ?? 0,
      score: (u.etapes_chasse_validees ?? 0) + (u.enigmes_trouvees ?? 0),
    }))
    .filter((u: any) => u.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 20);

  return c.json({ classement });
});

app.get('/:id/classement', async (c) => {
  const commune_id = c.get('commune_id');
  const chasse_id = c.req.param('id');

  const progressions = await supabaseSelect(c.env, 'progressions_chasse', {
    select: 'user_id,validee_at',
    commune_id: `eq.${commune_id}`, chasse_id: `eq.${chasse_id}`,
    order: 'validee_at.asc',
  });
  const users = await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom',
    commune_id: `eq.${commune_id}`,
  });

  const parUtilisateur = new Map<string, { total: number; derniere: string }>();
  for (const p of progressions) {
    const entree = parUtilisateur.get(p.user_id) ?? { total: 0, derniere: p.validee_at };
    entree.total += 1;
    entree.derniere = p.validee_at;
    parUtilisateur.set(p.user_id, entree);
  }

  const classement = [...parUtilisateur.entries()]
    .map(([user_id, stats]) => {
      const u = users.find((u: any) => u.id === user_id);
      return { prenom: u?.prenom ?? '?', total_etapes: stats.total, derniere_validation: stats.derniere };
    })
    .sort((a, b) => b.total_etapes - a.total_etapes || a.derniere_validation.localeCompare(b.derniere_validation));

  return c.json({ classement });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  await supabaseDelete(c.env, 'chasses_tresor', {
    id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

export default app;

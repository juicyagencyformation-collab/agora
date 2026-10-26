// worker/src/routes/messages_mairie.ts
// Bandeau "Message de la mairie" en haut de l'accueil (voir migration 086). Lecture : tout
// habitant connecté de la commune ; publication et retrait : gestionnaires uniquement.
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseInsert, supabaseDelete } from '../db';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';

const app = new Hono();
app.use('*', jwtMiddleware);

const DUREE_MAX_JOURS = 60;

const creationSchema = z.object({
  texte: z.string().trim().min(1).max(280),
  fin_le: z.string().datetime({ offset: true }),
  notifier: z.boolean().default(false),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  try {
    const messages = await supabaseSelect(c.env, 'messages_mairie', {
      select: 'id,texte,fin_le,created_at',
      commune_id: `eq.${commune_id}`, fin_le: `gt.${new Date().toISOString()}`, order: 'created_at.desc',
    });
    return c.json({ messages });
  } catch (e) {
    console.error('Lecture messages_mairie', e);
    return c.json({ erreur: 'Messages indisponibles' }, 500);
  }
});

app.post('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  if (!estGestionnaire(c.get('role'))) return c.json({ erreur: 'Réservé à la mairie' }, 403);

  const body = creationSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const fin = new Date(body.data.fin_le);
  const maintenant = Date.now();
  if (fin.getTime() <= maintenant) return c.json({ erreur: 'La date de fin doit être dans le futur.' }, 400);
  if (fin.getTime() > maintenant + DUREE_MAX_JOURS * 86400000) {
    return c.json({ erreur: `Un message s'affiche au plus ${DUREE_MAX_JOURS} jours.` }, 400);
  }

  try {
    const [message] = await supabaseInsert(c.env, 'messages_mairie', {
      commune_id, auteur_id: user_id, texte: body.data.texte, fin_le: fin.toISOString(),
    });
    if (body.data.notifier) {
      // Même préférence que les actualités : un message de la mairie EST une communication officielle.
      c.executionCtx.waitUntil((async () => {
        const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_articles');
        await envoyerNotificationAUtilisateurs(
          c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
          '📢 Message de la mairie', body.data.texte.slice(0, 140), '/index.html?onglet=accueil',
        );
      })());
    }
    return c.json({ message }, 201);
  } catch (e) {
    console.error('Création messages_mairie', e);
    return c.json({ erreur: 'Impossible de publier le message, réessaie dans un instant.' }, 500);
  }
});

app.delete('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  if (!estGestionnaire(c.get('role'))) return c.json({ erreur: 'Réservé à la mairie' }, 403);
  try {
    await supabaseDelete(c.env, 'messages_mairie', { id: `eq.${c.req.param('id')}`, commune_id: `eq.${commune_id}` });
    return c.json({ ok: true });
  } catch (e) {
    console.error('Suppression messages_mairie', e);
    return c.json({ erreur: 'Impossible de retirer le message.' }, 500);
  }
});

export default app;

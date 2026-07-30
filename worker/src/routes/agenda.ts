// worker/src/routes/agenda.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { genererIcs } from '../lib/ics';
import { uploaderFichier, deleteObject } from '../storage';
import { attribuerXp, XP_ACTIONS, incrementerCompteurUtilisateur } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';

// Nombre de participants à partir duquel un événement est considéré "réussi"
// (récompense l'organisateur, une seule fois par événement).
const SEUIL_EVENEMENT_SUCCES = 10;

const app = new Hono();
app.use('*', jwtMiddleware);

// Vérifie si un événement vient d'atteindre le seuil de succès et, si oui, récompense
// l'organisateur une seule fois (protégé par le booléen seuil_succes_atteint).
async function verifierSeuilSuccesEvenement(env: any, commune_id: string, event_id: string) {
  const [event] = await supabaseSelect(env, 'events', {
    select: 'id,user_id,seuil_succes_atteint', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event || event.seuil_succes_atteint) return;

  const participants = await supabaseSelect(env, 'event_attendees', {
    select: 'id', commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, actif: 'eq.true',
  });
  if (participants.length < SEUIL_EVENEMENT_SUCCES) return;

  await supabaseUpdate(env, 'events', { seuil_succes_atteint: true }, { id: `eq.${event_id}` });
  await incrementerCompteurUtilisateur(env, commune_id, event.user_id, 'evenements_reussis');
  await attribuerXp(env, commune_id, event.user_id, XP_ACTIONS.evenement_succes);
}

const creationSchema = z.object({
  titre: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  lieu: z.string().max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  date_debut: z.string().datetime(),
  date_fin: z.string().datetime(),
  r2_key: z.string().optional(),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const curseur = c.req.query('curseur');
  const historique = c.req.query('historique') === 'true';
  const user_id = c.get('user_id');

  const filtres: Record<string, string> = {
    select: 'id,user_id,titre,description,lieu,lat,lng,photo_url,officiel,date_debut,date_fin,created_at',
    commune_id: `eq.${commune_id}`,
    order: historique ? 'date_debut.desc' : 'date_debut.asc',
    limit: '20',
  };
  if (historique) {
    filtres.date_fin = `lt.${new Date().toISOString()}`;
  } else {
    filtres.date_fin = `gte.${new Date().toISOString()}`;
  }
  if (curseur) filtres.date_debut = historique ? `lt.${curseur}` : `gt.${curseur}`;

  const events = await supabaseSelect(c.env, 'events', filtres);
  const ids = events.map((e: any) => e.id);
  const idsAuteurs = [...new Set(events.map((e: any) => e.user_id))];

  const [participants, auteurs] = await Promise.all([
    ids.length ? supabaseSelect(c.env, 'event_attendees', {
      select: 'event_id,user_id,actif',
      commune_id: `eq.${commune_id}`,
      event_id: `in.(${ids.join(',')})`,
      actif: 'eq.true',
    }) : [],
    idsAuteurs.length ? supabaseSelect(c.env, 'users', {
      select: 'id,prenom,nom',
      commune_id: `eq.${commune_id}`,
      id: `in.(${idsAuteurs.join(',')})`,
    }) : [],
  ]);

  // Noms des participants (publics) — jamais leurs coordonnées, réservées à GET /:id/contacts.
  const idsParticipants = [...new Set(participants.map((p: any) => p.user_id))];
  const utilisateursParticipants = idsParticipants.length ? await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom', commune_id: `eq.${commune_id}`, id: `in.(${idsParticipants.join(',')})`,
  }) : [];

  const result = events.map((e: any) => {
    const auteur = auteurs.find((a: any) => a.id === e.user_id);
    const participantsEvent = participants.filter((p: any) => p.event_id === e.id);
    return {
      ...e,
      auteur_prenom: auteur?.prenom ?? '?',
      auteur_nom: auteur?.nom ?? '',
      est_moi: e.user_id === user_id,
      total_participants: participantsEvent.length,
      je_participe: participantsEvent.some((p: any) => p.user_id === user_id),
      participants: participantsEvent.map((p: any) => {
        const u = utilisateursParticipants.find((u: any) => u.id === p.user_id);
        return { prenom: u?.prenom ?? '?', nom: u?.nom ?? '' };
      }),
    };
  });

  return c.json({ events: result });
});

app.post('/upload', async (c) => {
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    return c.json({ erreur: 'Type de fichier non autorisé (jpeg/png/webp uniquement)' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 8 * 1024 * 1024) {
    return c.json({ erreur: 'Image trop lourde (max 8 Mo)' }, 400);
  }
  const extension = contentType.split('/')[1];
  const key = `${commune_id}/agenda/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

// POST / — ouvert à tout citoyen (plus réservé aux gestionnaires)
app.post('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = creationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  if (new Date(data.date_fin) <= new Date(data.date_debut)) {
    return c.json({ erreur: 'La date de fin doit être après la date de début' }, 400);
  }

  const [event] = await supabaseInsert(c.env, 'events', {
    commune_id, user_id, titre: data.titre,
    description: data.description ?? null, lieu: data.lieu ?? null,
    lat: data.lat ?? null, lng: data.lng ?? null,
    photo_url: data.r2_key ? `${c.env.R2_PUBLIC_BASE}/${data.r2_key}` : null,
    r2_key: data.r2_key ?? null,
    officiel: estGestionnaire(c.get('role')),
    date_debut: data.date_debut, date_fin: data.date_fin,
  });

  await incrementerCompteurUtilisateur(c.env, commune_id, user_id, 'evenements_crees');

  c.executionCtx.waitUntil((async () => {
    const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_agenda');
    await envoyerNotificationAUtilisateurs(
      c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
      '📅 Nouvel événement', data.titre, `/index.html?onglet=agenda&type=event&id=${event.id}`,
    );
  })());

  return c.json({ event_id: event.id }, 201);
});

const modificationSchema = creationSchema.partial();

app.patch('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const event_id = c.req.param('id');

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);
  if (event.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  const body = modificationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  const patch: Record<string, unknown> = {};
  if (data.titre) patch.titre = data.titre;
  if (data.description !== undefined) patch.description = data.description;
  if (data.lieu !== undefined) patch.lieu = data.lieu;
  if (data.lat !== undefined) patch.lat = data.lat;
  if (data.lng !== undefined) patch.lng = data.lng;
  if (data.date_debut) patch.date_debut = data.date_debut;
  if (data.date_fin) patch.date_fin = data.date_fin;
  if (data.r2_key) { patch.photo_url = `${c.env.R2_PUBLIC_BASE}/${data.r2_key}`; patch.r2_key = data.r2_key; }

  if (Object.keys(patch).length === 0) return c.json({ erreur: 'Aucun champ à modifier' }, 400);

  await supabaseUpdate(c.env, 'events', patch, { id: `eq.${event_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const event_id = c.req.param('id');

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,user_id,r2_key', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);
  if (event.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  if (event.r2_key) await deleteObject(c.env, event.r2_key);
  await supabaseDelete(c.env, 'events', { id: `eq.${event_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

const participationSchema = z.object({
  contact_telephone: z.string().max(30).optional(),
  contact_email: z.string().email().optional(),
});

app.post('/:id/participer', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const event_id = c.req.param('id');

  const body = participationSchema.safeParse(await c.req.json().catch(() => ({})));
  const contact = body.success ? body.data : {};

  const [existant] = await supabaseSelect(c.env, 'event_attendees', {
    select: 'id,actif',
    commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, user_id: `eq.${user_id}`,
  });

  if (!existant) {
    // Première participation : seule occasion où l'XP est attribuée pour cet événement
    await supabaseInsert(c.env, 'event_attendees', {
      commune_id, event_id, user_id, actif: true,
      contact_telephone: contact.contact_telephone ?? null,
      contact_email: contact.contact_email ?? null,
    });
    const resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.participer_evenement);
    await verifierSeuilSuccesEvenement(c.env, commune_id, event_id);
    return c.json({ ok: true, action: 'ajouté', xp_gagne: resultatXp.xp_gagne, nouveaux_badges: resultatXp.nouveaux_badges });
  }

  // Ré-inscription ou désinscription : jamais de nouvelle XP (empêche le farming par toggle répété)
  const patch: Record<string, unknown> = { actif: !existant.actif };
  if (!existant.actif) {
    if (contact.contact_telephone !== undefined) patch.contact_telephone = contact.contact_telephone;
    if (contact.contact_email !== undefined) patch.contact_email = contact.contact_email;
  }
  await supabaseUpdate(c.env, 'event_attendees', patch, { id: `eq.${existant.id}` });
  if (!existant.actif) await verifierSeuilSuccesEvenement(c.env, commune_id, event_id);
  return c.json({ ok: true, action: existant.actif ? 'retiré' : 'ajouté' });
});

// GET /:id/contacts — coordonnées des participants, réservé à l'organisateur ou aux gestionnaires
// (le nom des participants est public via GET /, mais téléphone/email restent privés).
app.get('/:id/contacts', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const event_id = c.req.param('id');

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,user_id', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);
  if (event.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé à l\'organisateur ou aux administrateurs' }, 403);
  }

  const participants = await supabaseSelect(c.env, 'event_attendees', {
    select: 'user_id,contact_telephone,contact_email',
    commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, actif: 'eq.true',
  });
  const idsUsers = participants.map((p: any) => p.user_id);
  const utilisateurs = idsUsers.length ? await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom', commune_id: `eq.${commune_id}`, id: `in.(${idsUsers.join(',')})`,
  }) : [];

  const result = participants.map((p: any) => {
    const u = utilisateurs.find((u: any) => u.id === p.user_id);
    return {
      prenom: u?.prenom ?? '?', nom: u?.nom ?? '',
      telephone: p.contact_telephone, email: p.contact_email,
    };
  });

  return c.json({ participants: result });
});

app.get('/:id/ics', async (c) => {
  const commune_id = c.get('commune_id');
  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,titre,description,lieu,date_debut,date_fin',
    commune_id: `eq.${commune_id}`, id: `eq.${c.req.param('id')}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);

  const ics = genererIcs(event);
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${event.id}.ics"`,
    },
  });
});

export default app;

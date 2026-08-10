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
import { genererQrSvg } from '../lib/qrcode';
import { distanceMetres } from '../lib/geo';
import {
  attribuerPointsParticipation, romprePresenceCitoyenne,
  SEUIL_GEOFENCE_METRES,
} from '../lib/points-citoyens';

// Nombre de participants à partir duquel un événement est considéré "réussi"
// (récompense l'organisateur, une seule fois par événement).
const SEUIL_EVENEMENT_SUCCES = 10;

// Catégories d'action civique — au-delà de "aucune" (undefined), une action programmée
// devient éligible au flux QR + validation humaine (voir necessite_validation_presence).
const TYPES_ACTION_VALIDES = [
  'reunion', 'atelier', 'reunion_conseil', 'nettoyage', 'plantation', 'maraude', 'chantier', 'aide_ponctuelle',
] as const;

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
  type_action: z.enum(TYPES_ACTION_VALIDES).optional(),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const curseur = c.req.query('curseur');
  const historique = c.req.query('historique') === 'true';
  const user_id = c.get('user_id');

  const filtres: Record<string, string> = {
    select: 'id,user_id,titre,description,lieu,lat,lng,photo_url,officiel,date_debut,date_fin,type_action,necessite_validation_presence,created_at',
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

  const idsEventsCiviques = events.filter((e: any) => e.necessite_validation_presence).map((e: any) => e.id);
  const mesParticipationsCitoyennes = idsEventsCiviques.length ? await supabaseSelect(c.env, 'participations_citoyennes', {
    select: 'event_id,statut', commune_id: `eq.${commune_id}`, event_id: `in.(${idsEventsCiviques.join(',')})`, user_id: `eq.${user_id}`,
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
      ma_participation_citoyenne: mesParticipationsCitoyennes.find((p: any) => p.event_id === e.id)?.statut ?? null,
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

  // Un événement "action civique" (points de participation, QR + validation) ne peut être
  // déclaré que par un gestionnaire — sinon un citoyen quelconque pourrait s'auto-attribuer
  // un type valant des points, s'inviter lui-même et s'auto-valider en tant qu'organisateur.
  const typeAction = data.type_action && estGestionnaire(c.get('role')) ? data.type_action : undefined;

  // Pas de point GPS choisi (l'organisateur n'était pas forcément sur place au moment de la
  // création) : on retombe sur les coordonnées de la commune plutôt que de laisser l'événement
  // sans position (invisible sur toutes les cartes, y compris "Autour de moi").
  let lat = data.lat;
  let lng = data.lng;
  if (lat == null || lng == null) {
    const [commune] = await supabaseSelect(c.env, 'communes', { select: 'lat,lng', id: `eq.${commune_id}` });
    lat = lat ?? commune?.lat ?? null;
    lng = lng ?? commune?.lng ?? null;
  }

  const [event] = await supabaseInsert(c.env, 'events', {
    commune_id, user_id, titre: data.titre,
    description: data.description ?? null, lieu: data.lieu ?? null,
    lat, lng,
    photo_url: data.r2_key ? `${c.env.R2_PUBLIC_BASE}/${data.r2_key}` : null,
    r2_key: data.r2_key ?? null,
    officiel: estGestionnaire(c.get('role')),
    date_debut: data.date_debut, date_fin: data.date_fin,
    type_action: typeAction ?? null,
    necessite_validation_presence: !!typeAction,
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

// type_action accepte aussi '' explicitement (le formulaire d'édition l'envoie pour repasser
// un événement civique en "classique") — un simple .enum().optional() rejetterait cette chaîne vide.
const modificationSchema = creationSchema.omit({ type_action: true }).partial().extend({
  type_action: z.union([z.enum(TYPES_ACTION_VALIDES), z.literal('')]).optional(),
});

app.patch('/:id', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const event_id = c.req.param('id');

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,user_id,type_action', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);
  if (event.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Non autorisé' }, 403);
  }

  const body = modificationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  // Même garde qu'à la création : seul un gestionnaire peut poser ou changer le type d'action
  // civique (voir POST / ci-dessus). Un simple citoyen éditant son propre événement ne peut
  // donc jamais y ajouter de points de participation.
  if (data.type_action !== undefined && !estGestionnaire(role)) {
    return c.json({ erreur: 'Seul un gestionnaire peut définir le type d\'action civique' }, 403);
  }

  if (data.type_action !== undefined && data.type_action !== event.type_action) {
    const [participationAvancee] = await supabaseSelect(c.env, 'participations_citoyennes', {
      select: 'id', commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, statut: 'neq.inscrit', limit: '1',
    });
    if (participationAvancee) {
      return c.json({ erreur: 'Impossible de changer le type d\'action : des présences ont déjà été scannées ou validées' }, 400);
    }
  }

  const patch: Record<string, unknown> = {};
  if (data.titre) patch.titre = data.titre;
  if (data.description !== undefined) patch.description = data.description;
  if (data.lieu !== undefined) patch.lieu = data.lieu;
  if (data.lat !== undefined) patch.lat = data.lat;
  if (data.lng !== undefined) patch.lng = data.lng;
  if (data.date_debut) patch.date_debut = data.date_debut;
  if (data.date_fin) patch.date_fin = data.date_fin;
  if (data.r2_key) { patch.photo_url = `${c.env.R2_PUBLIC_BASE}/${data.r2_key}`; patch.r2_key = data.r2_key; }
  if (data.type_action !== undefined) {
    patch.type_action = data.type_action || null;
    patch.necessite_validation_presence = !!data.type_action;
  }

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

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,necessite_validation_presence,date_debut', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);

  const body = participationSchema.safeParse(await c.req.json().catch(() => ({})));
  const contact = body.success ? body.data : {};

  const [existant] = await supabaseSelect(c.env, 'event_attendees', {
    select: 'id,actif',
    commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, user_id: `eq.${user_id}`,
  });

  if (!existant) {
    if (event.necessite_validation_presence) {
      const [utilisateur] = await supabaseSelect(c.env, 'users', {
        select: 'suspendu_jusqu_au', commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
      });
      if (utilisateur?.suspendu_jusqu_au && new Date(utilisateur.suspendu_jusqu_au) > new Date()) {
        return c.json({ erreur: 'Inscriptions temporairement suspendues suite à plusieurs absences non signalées.' }, 403);
      }
    }

    // Première participation : seule occasion où l'XP est attribuée pour cet événement
    await supabaseInsert(c.env, 'event_attendees', {
      commune_id, event_id, user_id, actif: true,
      contact_telephone: contact.contact_telephone ?? null,
      contact_email: contact.contact_email ?? null,
    });
    if (event.necessite_validation_presence) {
      await supabaseInsert(c.env, 'participations_citoyennes', { commune_id, event_id, user_id, statut: 'inscrit' });
    }
    const resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.participer_evenement);
    await verifierSeuilSuccesEvenement(c.env, commune_id, event_id);
    return c.json({ ok: true, action: 'ajouté', ...resultatXp });
  }

  // Ré-inscription ou désinscription : jamais de nouvelle XP (empêche le farming par toggle répété)
  const patch: Record<string, unknown> = { actif: !existant.actif };
  if (!existant.actif) {
    if (contact.contact_telephone !== undefined) patch.contact_telephone = contact.contact_telephone;
    if (contact.contact_email !== undefined) patch.contact_email = contact.contact_email;
  }
  await supabaseUpdate(c.env, 'event_attendees', patch, { id: `eq.${existant.id}` });

  if (event.necessite_validation_presence) {
    const [participation] = await supabaseSelect(c.env, 'participations_citoyennes', {
      select: 'id,statut', commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, user_id: `eq.${user_id}`,
    });
    if (existant.actif) {
      // Désinscription : conséquence selon le délai avant l'action.
      if (participation && participation.statut === 'inscrit') {
        const heuresAvant = (new Date(event.date_debut).getTime() - Date.now()) / 3600000;
        if (heuresAvant >= 24) {
          await supabaseUpdate(c.env, 'participations_citoyennes', { statut: 'desiste_a_temps' }, { id: `eq.${participation.id}` });
        } else {
          await romprePresenceCitoyenne(c.env, commune_id, user_id, participation, 'desiste_tardif');
        }
      }
    } else if (participation && participation.statut === 'desiste_a_temps') {
      // Ré-inscription après un désistement à temps.
      await supabaseUpdate(c.env, 'participations_citoyennes', { statut: 'inscrit' }, { id: `eq.${participation.id}` });
    } else if (!participation) {
      await supabaseInsert(c.env, 'participations_citoyennes', { commune_id, event_id, user_id, statut: 'inscrit' });
    }
  }

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

// ── Participation citoyenne vérifiée (scan QR + validation humaine) ──
// Distincte de /:id/participer (simple inscription "je participe") : ces routes ne
// s'appliquent qu'aux événements avec necessite_validation_presence.

const scanSchema = z.object({
  qr_token: z.string().uuid(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

// POST /:id/scanner — tout citoyen connecté, à son arrivée sur place. Ne crédite aucun
// point : seule la validation humaine qui suit (ci-dessous) le fait.
app.post('/:id/scanner', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const event_id = c.req.param('id');

  const body = scanSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,qr_token,necessite_validation_presence,lat,lng,date_debut,date_fin',
    commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);
  if (!event.necessite_validation_presence) return c.json({ erreur: 'Cet événement ne nécessite pas de scan de présence' }, 400);
  if (event.qr_token !== body.data.qr_token) return c.json({ erreur: 'QR code invalide' }, 400);

  const debut = new Date(event.date_debut).getTime();
  const fin = new Date(event.date_fin).getTime();
  const maintenant = Date.now();
  if (maintenant < debut - 30 * 60000 || maintenant > fin + 2 * 3600000) {
    return c.json({ erreur: 'Hors de la fenêtre de présence pour cette action' }, 400);
  }

  const [existant] = await supabaseSelect(c.env, 'participations_citoyennes', {
    select: 'id,statut', commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, user_id: `eq.${user_id}`,
  });
  if (existant && existant.statut !== 'inscrit') {
    return c.json({ erreur: 'Présence déjà déclarée pour cette action' }, 409);
  }

  const horsGeofence = event.lat != null && event.lng != null && body.data.lat != null && body.data.lng != null
    ? distanceMetres(event.lat, event.lng, body.data.lat, body.data.lng) > SEUIL_GEOFENCE_METRES
    : false;

  const patch = {
    statut: 'scanne', scan_le: new Date().toISOString(),
    scan_lat: body.data.lat ?? null, scan_lng: body.data.lng ?? null,
    hors_geofence: horsGeofence,
  };

  if (existant) {
    await supabaseUpdate(c.env, 'participations_citoyennes', patch, { id: `eq.${existant.id}` });
  } else {
    // Marcheur spontané (walk-in), pas de ligne "inscrit" préalable.
    await supabaseInsert(c.env, 'participations_citoyennes', { commune_id, event_id, user_id, ...patch });
  }

  return c.json({ ok: true, hors_geofence: horsGeofence });
});

// GET /:id/participations-citoyennes — organisateur/élu/superadmin uniquement. NB : volontairement
// PAS estGestionnaire ici — un admin qui n'est pas l'organisateur n'a pas accès (règle du document).
app.get('/:id/participations-citoyennes', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const event_id = c.req.param('id');

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,user_id,titre,lieu,date_debut,type_action', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);

  const peutGererPresences = event.user_id === user_id || ['elu', 'maire', 'superadmin'].includes(role);
  if (!peutGererPresences) return c.json({ erreur: 'Non autorisé' }, 403);

  const participations = await supabaseSelect(c.env, 'participations_citoyennes', {
    select: 'id,user_id,statut,scan_le,hors_geofence,contestee_le',
    commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, order: 'created_at.asc',
  });
  const idsUsers = participations.map((p: any) => p.user_id);
  const utilisateurs = idsUsers.length ? await supabaseSelect(c.env, 'users', {
    select: 'id,prenom,nom', commune_id: `eq.${commune_id}`, id: `in.(${idsUsers.join(',')})`,
  }) : [];

  const liste = participations.map((p: any) => {
    const u = utilisateurs.find((u: any) => u.id === p.user_id);
    return { ...p, prenom: u?.prenom ?? '?', nom: u?.nom ?? '' };
  });

  // Audit superadmin : organisateur qui valide (presque) tout sans qu'aucun scan n'ait eu lieu.
  let alerte_audit = false;
  if (role === 'superadmin') {
    const confirmees = liste.filter((p: any) => p.statut === 'confirme');
    const sansScan = confirmees.filter((p: any) => !p.scan_le);
    alerte_audit = confirmees.length >= 5 && sansScan.length / confirmees.length > 0.95;
  }

  return c.json({
    event: { titre: event.titre, lieu: event.lieu, date_debut: event.date_debut, type_action: event.type_action },
    role_validateur: role,
    total_confirmes: liste.filter((p: any) => p.statut === 'confirme').length,
    total: liste.length,
    participations: liste,
    alerte_audit,
  });
});

// PATCH /:id/participations-citoyennes/:pid/valider — organisateur/élu depuis "scanne"
// uniquement ; superadmin depuis n'importe quel statut (pouvoir d'audit/correction).
app.patch('/:id/participations-citoyennes/:pid/valider', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const event_id = c.req.param('id');
  const pid = c.req.param('pid');

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,user_id,type_action', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);

  const peutGererPresences = event.user_id === user_id || ['elu', 'maire', 'superadmin'].includes(role);
  if (!peutGererPresences) return c.json({ erreur: 'Non autorisé' }, 403);

  const [participation] = await supabaseSelect(c.env, 'participations_citoyennes', {
    select: 'id,user_id,statut', commune_id: `eq.${commune_id}`, id: `eq.${pid}`, event_id: `eq.${event_id}`,
  });
  if (!participation) return c.json({ erreur: 'Participation introuvable' }, 404);
  if (participation.statut === 'confirme') return c.json({ ok: true, deja_confirme: true });

  if (role !== 'superadmin' && participation.statut !== 'scanne') {
    return c.json({ erreur: 'Cette présence n\'a pas encore été scannée' }, 400);
  }

  await supabaseUpdate(c.env, 'participations_citoyennes', {
    statut: 'confirme', valide_par: user_id, valide_le: new Date().toISOString(),
  }, { id: `eq.${pid}` });

  const resultat = await attribuerPointsParticipation(c.env, commune_id, participation.user_id, event as any, role, user_id);
  await supabaseUpdate(c.env, 'participations_citoyennes', { points_attribues: resultat.points_gagnes }, { id: `eq.${pid}` });

  return c.json({ ok: true, points_gagnes: resultat.points_gagnes, nouveaux_badges: resultat.nouveaux_badges });
});

// POST /:id/participations-citoyennes/valider-tous — "valider tous les scannés". Idempotent
// par construction : un second clic ne matche plus aucune ligne (filtre statut=scanne).
app.post('/:id/participations-citoyennes/valider-tous', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const event_id = c.req.param('id');

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,user_id,type_action', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);

  const peutGererPresences = event.user_id === user_id || ['elu', 'maire', 'superadmin'].includes(role);
  if (!peutGererPresences) return c.json({ erreur: 'Non autorisé' }, 403);

  const valides = await supabaseUpdate(c.env, 'participations_citoyennes', {
    statut: 'confirme', valide_par: user_id, valide_le: new Date().toISOString(),
  }, { commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, statut: 'eq.scanne' });

  let pointsTotaux = 0;
  for (const p of valides) {
    const resultat = await attribuerPointsParticipation(c.env, commune_id, p.user_id, event as any, role, user_id);
    await supabaseUpdate(c.env, 'participations_citoyennes', { points_attribues: resultat.points_gagnes }, { id: `eq.${p.id}` });
    pointsTotaux += resultat.points_gagnes;
  }

  return c.json({ ok: true, nombre_valides: valides.length, points_totaux: pointsTotaux });
});

// POST /:id/contester — le citoyen conteste sa propre présence non confirmée (scan ou
// validation manquant après 48h). Retrouvée par event_id + son propre user_id : pas besoin
// que le client connaisse l'identifiant interne de la ligne participations_citoyennes.
app.post('/:id/contester', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const event_id = c.req.param('id');

  const [participation] = await supabaseSelect(c.env, 'participations_citoyennes', {
    select: 'id,statut', commune_id: `eq.${commune_id}`, event_id: `eq.${event_id}`, user_id: `eq.${user_id}`,
  });
  if (!participation) return c.json({ erreur: 'Participation introuvable' }, 404);
  if (participation.statut !== 'non_confirme') {
    return c.json({ erreur: 'Seule une présence "non confirmée" peut être contestée' }, 400);
  }

  await supabaseUpdate(c.env, 'participations_citoyennes', { contestee_le: new Date().toISOString() }, { id: `eq.${participation.id}` });
  return c.json({ ok: true });
});

// PATCH /:id/participations-citoyennes/:pid/rejeter-contestation — superadmin seul. Ne
// crédite rien : pour créditer, le superadmin utilise plutôt la route /valider normale.
app.patch('/:id/participations-citoyennes/:pid/rejeter-contestation', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') return c.json({ erreur: 'Réservé au superadmin' }, 403);
  const commune_id = c.get('commune_id');
  const event_id = c.req.param('id');
  const pid = c.req.param('pid');

  await supabaseUpdate(c.env, 'participations_citoyennes', { contestee_le: null }, {
    id: `eq.${pid}`, event_id: `eq.${event_id}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true });
});

// GET /:id/qr-page — organisateur ou gestionnaire, pour imprimer/afficher le QR sur place.
app.get('/:id/qr-page', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  const event_id = c.req.param('id');

  const [event] = await supabaseSelect(c.env, 'events', {
    select: 'id,user_id,titre,qr_token', commune_id: `eq.${commune_id}`, id: `eq.${event_id}`,
  });
  if (!event) return c.json({ erreur: 'Événement introuvable' }, 404);
  if (event.user_id !== user_id && !estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé à l\'organisateur ou aux administrateurs' }, 403);
  }

  // Titre affiché en clair dans une page HTML : échappement obligatoire (contenu saisi
  // par un organisateur, jamais fait confiance directement dans du HTML).
  const titreEchappe = event.titre.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = genererQrSvg(event.qr_token, 320);
  return c.html(`<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QR — ${titreEchappe}</title>
<style>
  body { font-family: sans-serif; text-align: center; padding: 28px 16px; color: #3D3530; }
  h1 { font-size: 19px; margin: 0 0 6px; }
  p { color: #8B7355; font-size: 14px; margin: 0; }
  .qr { margin: 24px auto; max-width: 320px; }
  .qr svg { width: 100%; height: auto; }
  .token { font-family: monospace; font-size: 11px; color: #C8DDE4; margin-top: 18px; }
  @media print { .token { color: #ccc; } }
</style>
</head>
<body>
  <h1>${titreEchappe}</h1>
  <p>À scanner sur place pour déclarer sa présence</p>
  <div class="qr">${svg}</div>
  <p class="token">${event.qr_token}</p>
</body>
</html>`);
});

export default app;

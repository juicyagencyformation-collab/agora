// worker/src/cron.ts
import { supabaseDelete, supabaseSelect, supabaseUpdate } from './db';
import { deleteObject } from './storage';
import { romprePresenceCitoyenne, verifierSuspensionNoShow, crediterOrganisationAction } from './lib/points-citoyens';
import { envoyerEmailEcheance } from './backoffice/email-commune';
import { corrigerEmailsInvalides } from './backoffice/prospection';
import { verifierRelanceInactivite } from './backoffice/onboarding';
import { verifierSequenceOnboarding } from './backoffice/onboarding-drip';

export async function nettoyerCoupsDeMainExpires(env: any) {
  const seuil = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  await supabaseDelete(env, 'coups_de_main', { expires_at: `lt.${seuil}` });
}

// Purge quotidienne de "Photo du jour" — chaque commune a sa propre durée de rétention
// (1 jour / 1 semaine / 1 mois), donc on ne peut plus se contenter d'un seul jour fixe.
export async function purgerPhotosDuJour(env: any) {
  const communes = await supabaseSelect(env, 'communes', { select: 'id,photo_jour_duree' });

  for (const commune of communes) {
    const duree = commune.photo_jour_duree ?? 'semaine';
    const jours = duree === 'jour' ? 1 : duree === 'mois' ? 30 : 7;
    const seuil = new Date(Date.now() - jours * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const photos = await supabaseSelect(env, 'photos_du_jour', {
      select: 'id,r2_key', commune_id: `eq.${commune.id}`, date_publication: `lt.${seuil}`,
    });
    if (!photos.length) continue;

    await Promise.all(photos.map((p: any) => deleteObject(env, p.r2_key)));
    await supabaseDelete(env, 'photos_du_jour', { id: `in.(${photos.map((p: any) => p.id).join(',')})` });
  }
}

// Purge quotidienne de "Énigme photo" — durée bien plus généreuse que Photo du jour
// (48h / 1 semaine / 1 mois / 6 mois / 1 an), puisqu'il faut le temps de se déplacer physiquement
// pour résoudre une énigme, contrairement à un flux social quotidien.
export async function purgerEnigmes(env: any) {
  const communes = await supabaseSelect(env, 'communes', { select: 'id,enigme_duree' });

  for (const commune of communes) {
    const duree = commune.enigme_duree ?? 'mois';
    const heures = duree === '48h' ? 48
      : duree === 'semaine' ? 24 * 7
      : duree === '6mois' ? 24 * 30 * 6
      : duree === 'an' ? 24 * 365
      : 24 * 30; // 'mois' par défaut
    const seuil = new Date(Date.now() - heures * 3600 * 1000).toISOString();

    const enigmes = await supabaseSelect(env, 'photos_enigmes', {
      select: 'id,r2_key', commune_id: `eq.${commune.id}`, created_at: `lt.${seuil}`,
    });
    if (!enigmes.length) continue;

    await Promise.all(enigmes.map((e: any) => deleteObject(env, e.r2_key)));
    await supabaseDelete(env, 'photos_enigmes', { id: `in.(${enigmes.map((e: any) => e.id).join(',')})` });
  }
}

// Purge quotidienne du Mur des voisins — messages éphémères (24h ou 48h selon la commune).
// Les messages n'ont pas de photo (module simplifié), pas de nettoyage R2 nécessaire.
export async function purgerMur(env: any) {
  const communes = await supabaseSelect(env, 'communes', { select: 'id,mur_duree' });

  for (const commune of communes) {
    const duree = commune.mur_duree ?? '48h';
    const heures = duree === '24h' ? 24 : 48;
    const seuil = new Date(Date.now() - heures * 3600 * 1000).toISOString();

    const posts = await supabaseSelect(env, 'posts', {
      select: 'id', commune_id: `eq.${commune.id}`, created_at: `lt.${seuil}`,
    });
    if (!posts.length) continue;

    await supabaseDelete(env, 'posts', { id: `in.(${posts.map((p: any) => p.id).join(',')})` });
  }
}

// Récupère TOUTES les clés R2 référencées dans une colonne d'une table, en paginant pour
// ne jamais tronquer (une clé oubliée = un fichier vivant supprimé par erreur : à éviter).
async function ajouterClesReferencees(env: any, table: string, colonne: string, cles: Set<string>) {
  const page = 1000;
  let offset = 0;
  for (;;) {
    const lignes = await supabaseSelect(env, table, { select: colonne, limit: String(page), offset: String(offset) });
    for (const l of lignes) { if (l[colonne]) cles.add(l[colonne]); }
    if (lignes.length < page) break;
    offset += page;
  }
}

// Purge des fichiers R2 orphelins du module "Mémoire du village" : un habitant peut
// choisir une photo / un audio puis abandonner le formulaire → l'objet reste sur R2 sans
// jamais être rattaché en base. On supprime uniquement les objets du préfixe .../memoire/
// vieux de plus de 2 jours ET absents de la base (délai de grâce large : un formulaire est
// toujours soumis en quelques minutes). Volontairement limité à ce module pour rester sûr —
// extensible aux autres préfixes une fois éprouvé.
export async function purgerOrphelinsMemoire(env: any) {
  if (!env.BUCKET_R2) return;

  const clesReferencees = new Set<string>();
  await ajouterClesReferencees(env, 'souvenir_images', 'r2_key', clesReferencees);
  await ajouterClesReferencees(env, 'souvenirs', 'audio_r2_key', clesReferencees);

  const graceMs = 2 * 24 * 3600 * 1000;
  const maintenant = Date.now();
  const communes = await supabaseSelect(env, 'communes', { select: 'id' });

  for (const commune of communes) {
    let cursor: string | undefined;
    for (;;) {
      const res: any = await env.BUCKET_R2.list({ prefix: `${commune.id}/memoire/`, cursor, limit: 1000 });
      for (const obj of res.objects) {
        const uploaded = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
        if (maintenant - uploaded < graceMs) continue;      // trop récent, peut-être en cours d'attache
        if (clesReferencees.has(obj.key)) continue;          // référencé en base → on garde
        await deleteObject(env, obj.key);
      }
      if (!res.truncated) break;
      cursor = res.cursor;
    }
  }
}

// Clôture quotidienne des actions civiques (participation citoyenne — voir
// worker/src/lib/points-citoyens.ts) :
// 1. Scanné mais jamais validé par l'organisateur, 48h après la fin -> "non confirmé"
//    (ni point ni pénalité, pour ne jamais punir un simple oubli d'organisateur).
// 2. Inscrit mais jamais scanné -> no-show (pénalité + vérification de suspension).
// 3. Organisateur récompensé une fois l'action terminée (idempotent par événement).
export async function cloturerActionsCiviques(env: any) {
  const communes = await supabaseSelect(env, 'communes', { select: 'id' });
  const seuil48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const maintenant = new Date().toISOString();

  for (const commune of communes) {
    const eventsTermines = await supabaseSelect(env, 'events', {
      select: 'id,user_id,date_fin', commune_id: `eq.${commune.id}`,
      necessite_validation_presence: 'eq.true', date_fin: `lt.${maintenant}`,
    });
    if (!eventsTermines.length) continue;
    const idsEvents = eventsTermines.map((e: any) => e.id);

    const idsAssezVieux = eventsTermines.filter((e: any) => e.date_fin < seuil48h).map((e: any) => e.id);
    if (idsAssezVieux.length) {
      await supabaseUpdate(env, 'participations_citoyennes', { statut: 'non_confirme' }, {
        commune_id: `eq.${commune.id}`, event_id: `in.(${idsAssezVieux.join(',')})`, statut: 'eq.scanne',
      });
    }

    const inscritsJamaisScannes = await supabaseSelect(env, 'participations_citoyennes', {
      select: 'id,user_id', commune_id: `eq.${commune.id}`,
      event_id: `in.(${idsEvents.join(',')})`, statut: 'eq.inscrit',
    });
    for (const p of inscritsJamaisScannes) {
      await romprePresenceCitoyenne(env, commune.id, p.user_id, p, 'no_show');
      await verifierSuspensionNoShow(env, commune.id, p.user_id);
    }

    for (const event of eventsTermines) {
      await crediterOrganisationAction(env, commune.id, event);
    }
  }
}

// Rappel d'échéance d'abonnement — 60 jours avant (voir migration 034_facturation.sql).
// Une seule relance par cycle : derniere_relance_echeance_le n'est remise à zéro que quand le
// staff marque l'échéance payée (POST /administration/communes/:id/abonnement/marquer-paye),
// donc pas de spam quotidien tant que rien n'a changé.
export async function relancerEcheancesFacturation(env: any) {
  const dans60Jours = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const communes = await supabaseSelect(env, 'communes', {
    select: 'id,nom,contact_email,email_mairie,prix_annuel_ttc,prochaine_echeance,derniere_relance_echeance_le',
    niveau_national: 'not.is.true',
    prochaine_echeance: `lte.${dans60Jours}`,
  });

  for (const commune of communes) {
    if (!commune.prochaine_echeance || commune.derniere_relance_echeance_le) continue;
    const destinataire = commune.contact_email || commune.email_mairie;
    if (!destinataire) continue;

    await envoyerEmailEcheance(env, {
      nomCommune: commune.nom, destinataire,
      echeance: commune.prochaine_echeance, montant: commune.prix_annuel_ttc,
    });
    await supabaseUpdate(env, 'communes', { derniere_relance_echeance_le: new Date().toISOString() }, { id: `eq.${commune.id}` });
  }
}

// Rattrapage quotidien des emails de prospects signalés en échec (bounces Resend, voir
// migration 030) : retente l'annuaire officiel pour chacun, dans l'espoir d'une adresse plus à
// jour. Ne renvoie rien tout seul — corrige juste la donnée pour le prochain envoi manuel.
export async function corrigerEmailsProspectsInvalides(env: any) {
  await corrigerEmailsInvalides(env);
}

// Relance douce si une commune a eu une 1re inscription citoyenne puis plus aucune activité
// depuis 5 à 9 jours (voir verifierRelanceInactivite dans backoffice/onboarding.ts).
export async function verifierRelancesInactiviteProspection(env: any) {
  await verifierRelanceInactivite(env);
}

// Séquence d'onboarding/upsell des communes gratuites (voir backoffice/onboarding-drip.ts) :
// 4 emails déclenchés par ancienneté du compte (J+3/J+7) et par signaux d'activation réels
// (jamais l'email 5 sur un critère de date seul).
export async function verifierSequenceOnboardingCommunes(env: any) {
  await verifierSequenceOnboarding(env);
}


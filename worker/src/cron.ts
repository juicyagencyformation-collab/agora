// worker/src/cron.ts
import { supabaseDelete, supabaseSelect, supabaseUpdate } from './db';
import { deleteObject } from './storage';
import { romprePresenceCitoyenne, verifierSuspensionNoShow, crediterOrganisationAction } from './lib/points-citoyens';
import { envoyerEmailEcheance } from './backoffice/email-commune';
import { corrigerEmailsInvalides } from './backoffice/prospection';
import { gererVariantesProspectionAutomatiquement } from './backoffice/prospection-ab';
import { verifierRelanceInactivite } from './backoffice/onboarding';
import { verifierSequenceOnboarding } from './backoffice/onboarding-drip';
import { synchroniserEmailsRecus } from './backoffice/emails-recus';
import { envoyerBilansMensuels } from './lib/bilan-mensuel';

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

// Vérification quotidienne des variantes A/B de l'email de présentation : bascule d'urgence si
// la variante active bounce trop, ou promotion d'un gagnant clairement établi (voir
// backoffice/prospection-ab.ts pour les seuils et le détail de la décision).
export async function verifierVariantesProspection(env: any) {
  await gererVariantesProspectionAutomatiquement(env);
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

// Comble les trous de "Réponses reçues" en repartant de la liste faisant autorité de Resend —
// voir synchroniserEmailsRecus (backoffice/emails-recus.ts) : le webhook seul ne suffit pas
// (constaté le 2026-08-27, réponses d'absence des mairies jamais capturées).
export async function synchroniserEmailsRecusProspection(env: any) {
  await synchroniserEmailsRecus(env);
}

// Bilan mensuel envoyé au maire des communes en formule Accompagné/Premium — voir
// lib/bilan-mensuel.ts pour le détail et le pourquoi (argument de vente, remplace l'idée
// initiale de sondage hebdo automatique). Branché sur le cron du 1er du mois à 3h.
export async function envoyerBilansMensuelsCommunes(env: any) {
  await envoyerBilansMensuels(env);
}

// Rafraîchissement quotidien du contenu de démo de "Bonvivre" (voir migrations 075 et 077) —
// ce contenu a été semé avec des décalages relatifs ("il y a 2 jours", "dans 4 jours"...) mais
// reste figé en absolu une fois en base : sans ce correctif, la démo vieillit comme un vrai
// contenu et finit par paraître abandonnée (retour utilisateur du 2026-10-06, actus de juin
// vues en octobre). On recale chaque nuit les mêmes décalages par rapport à "maintenant", pour
// une démo toujours fraîche, sans jamais avoir à y retoucher à la main. Les décalages ci-dessous
// doivent rester synchronisés avec ceux des deux migrations de seed — elles ne tournent qu'une
// fois (à la création des lignes), ce correctif tourne toutes les nuits et fait foi ensuite.
//
// Sécurité : on exige acces_libre = true en plus du slug, pas l'un ou l'autre — si "bonvivre"
// était un jour repurposé en vraie commune cliente (slug conservé mais acces_libre repassé à
// false), ce correctif doit s'arrêter de lui-même plutôt que d'écraser silencieusement les
// dates de contenus réels qu'un élu aurait pu nommer à l'identique par coïncidence. Toujours
// scopé par commune_id sur chaque requête (comme toute écriture de ce projet), donc même en cas
// de bug ici, aucune autre commune ne peut être affectée. Entouré d'un try/catch : une panne
// Supabase sur ce correctif cosmétique ne doit jamais faire échouer les tâches plus critiques
// du même cron (relances de facturation, prospection...) qui s'exécutent avant lui.
export async function rafraichirContenuDemoBonvivre(env: any) {
  try {
    await rafraichirContenuDemoBonvivreInterne(env);
  } catch (err) {
    console.error('rafraichirContenuDemoBonvivre a échoué (sans impact sur le reste du cron) :', err);
  }
}

// Décalage UTC (en minutes) d'un fuseau à un instant donné — gère automatiquement l'heure d'été/
// hiver, sans dépendance externe (Intl à heure fixe, dispo nativement dans le runtime Workers).
function decalageUTCMinutes(date: Date, zone: string): number {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)) parts[p.type] = p.value;
  const commeUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((commeUTC - date.getTime()) / 60000);
}

// Instant UTC correspondant à heure:minute LOCAL PARIS le jour calendaire de `jourCalendaire`
// (seule sa partie année/mois/jour UTC est utilisée). Centralise la gestion CET/CEST : ne jamais
// faire `new Date(... + n * 24h)` puis afficher l'heure attendue sans passer par cette fonction,
// sous peine de revivre le bug des heures "14:39"/"08:14" (décalage CEST/CET non pris en compte).
function instantParis(jourCalendaire: Date, heure: number, minute: number): Date {
  const aaaaMmJj = jourCalendaire.toISOString().slice(0, 10);
  const approx = new Date(`${aaaaMmJj}T${String(heure).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  return new Date(approx.getTime() - decalageUTCMinutes(approx, 'Europe/Paris') * 60000);
}

// Contenu "evergreen" sans date réelle (marché, atelier...) : toujours dans `nbJours` jours à
// partir d'aujourd'hui, à une heure ronde fixe (heure de Paris).
function dansJoursA(nbJours: number, heure: number, minute = 0): Date {
  return instantParis(new Date(Date.now() + nbJours * 24 * 3600 * 1000), heure, minute);
}

// Contenu ancré sur une vraie date calendaire récurrente (11 Novembre, Halloween...) : la
// PROCHAINE occurrence de jour/mois à heure fixe (heure de Paris) — bascule automatiquement sur
// l'année suivante une fois la date dépassée, pour ne jamais sembler périmé ni dans le passé
// (contrairement à un décalage relatif comme "+18 jours", qui n'a pas de sens pour une date fixe
// — bug corrigé le 2026-10-07 : "Commémoration du 11 Novembre" placée au 25 octobre).
function prochaineOccurrence(mois: number, jourDuMois: number, heure: number, minute = 0): Date {
  const annee = new Date().getUTCFullYear();
  const cetteAnnee = instantParis(new Date(Date.UTC(annee, mois - 1, jourDuMois)), heure, minute);
  return cetteAnnee.getTime() > Date.now() ? cetteAnnee : instantParis(new Date(Date.UTC(annee + 1, mois - 1, jourDuMois)), heure, minute);
}

async function rafraichirContenuDemoBonvivreInterne(env: any) {
  const [commune] = await supabaseSelect(env, 'communes', { select: 'id,acces_libre', slug: 'eq.bonvivre' });
  if (!commune || !commune.acces_libre) return;
  const commune_id = commune.id;

  const jours = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();
  const heures = (n: number) => new Date(Date.now() + n * 3600 * 1000).toISOString();

  // Actualités : created_at = updated_at (jamais modifiées après publication dans ce seed).
  const actus: Array<[string, number]> = [
    ['Le marché du samedi fait son grand retour !', -2],
    ["Travaux de réfection de la rue principale : ce qu'il faut savoir", -5],
    ['Un nouveau composteur collectif au quartier des Tilleuls', -9],
    ['Halloween des enfants : le programme complet', -1],
    ['Nouveaux horaires de la mairie à partir de septembre', -12],
    ['Collecte de jouets solidaire : donnez une seconde vie à vos jouets', -1],
  ];
  for (const [titre, decalageJours] of actus) {
    const date = jours(decalageJours);
    await supabaseUpdate(env, 'articles', { created_at: date, updated_at: date }, { commune_id: `eq.${commune_id}`, titre: `eq.${titre}` });
  }

  // Alertes
  await supabaseUpdate(env, 'alertes', { created_at: heures(-3) }, { commune_id: `eq.${commune_id}`, titre: "eq.Fuite d'eau rue des Lilas" });
  await supabaseUpdate(env, 'alertes', { created_at: jours(-1) }, { commune_id: `eq.${commune_id}`, titre: "eq.Nid de frelons près de l'école" });
  await supabaseUpdate(env, 'alertes', { created_at: jours(-10), reponse_le: jours(-7) }, { commune_id: `eq.${commune_id}`, titre: "eq.Éclairage public défaillant place de l'Église" });

  // Coups de main : [titre, décalage création (jours), décalage expiration (jours)]
  const coupsDeMain: Array<[string, number, number]> = [
    ['Je prête ma perceuse et mon établi', -4, 85],
    ["Besoin d'aide pour tailler une haie", -2, 20],
    ['Disponible pour du babysitting occasionnel', -6, 60],
    ['Covoiturage recherché pour le marché de Noël', -1, 25],
  ];
  for (const [titre, creation, expiration] of coupsDeMain) {
    await supabaseUpdate(env, 'coups_de_main', { created_at: jours(creation), expires_at: jours(expiration) }, { commune_id: `eq.${commune_id}`, titre: `eq.${titre}` });
  }

  // Agenda — contenu "evergreen" : toujours à N jours d'aujourd'hui, heure ronde fixe (Paris).
  // [titre, décalage création (jours), décalage début (jours), heure début, minute début, durée (h)]
  const agendaRelatif: Array<[string, number, number, number, number, number]> = [
    ['Marché hebdomadaire', -2, 4, 8, 0, 5],
    ['Conseil municipal ouvert au public', -3, 9, 18, 30, 2],
    ['Atelier compostage', -5, 6, 10, 0, 2],
    ['Repas des aînés', -4, 22, 12, 0, 3],
  ];
  for (const [titre, creation, debutJours, heureDebut, minuteDebut, dureeHeures] of agendaRelatif) {
    const dateDebut = dansJoursA(debutJours, heureDebut, minuteDebut);
    const dateFin = new Date(dateDebut.getTime() + dureeHeures * 3600 * 1000);
    await supabaseUpdate(env, 'events', {
      created_at: dansJoursA(creation, 9, 0).toISOString(),
      date_debut: dateDebut.toISOString(), date_fin: dateFin.toISOString(),
    }, { commune_id: `eq.${commune_id}`, titre: `eq.${titre}` });
  }

  // Agenda — ancré sur une vraie date calendaire récurrente (jamais de décalage relatif ici,
  // voir prochaineOccurrence). [titre, mois, jour, heure début, minute début, durée (h),
  // décalage de création avant l'événement (jours)]
  const agendaAncre: Array<[string, number, number, number, number, number, number]> = [
    ['Halloween des enfants', 10, 31, 18, 0, 2, 4],
    ['Commémoration du 11 Novembre', 11, 11, 11, 0, 1, 6],
  ];
  for (const [titre, mois, jourDuMois, heureDebut, minuteDebut, dureeHeures, creationAvant] of agendaAncre) {
    const dateDebut = prochaineOccurrence(mois, jourDuMois, heureDebut, minuteDebut);
    const dateFin = new Date(dateDebut.getTime() + dureeHeures * 3600 * 1000);
    const dateCreation = new Date(dateDebut.getTime() - creationAvant * 24 * 3600 * 1000);
    await supabaseUpdate(env, 'events', {
      created_at: dateCreation.toISOString(),
      date_debut: dateDebut.toISOString(), date_fin: dateFin.toISOString(),
    }, { commune_id: `eq.${commune_id}`, titre: `eq.${titre}` });
  }
}


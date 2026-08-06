// worker/src/lib/points-citoyens.ts
// Moteur du score de participation citoyenne — système séparé de l'XP/niveau
// (worker/src/lib/gamification.ts), qui reste inchangé. Toute écriture passe par
// crediterScoreCitoyen, qui journalise dans points_citoyens_history (source de vérité
// pour toute logique en fenêtre glissante : dégressivité, plafonds, suspensions) puis
// met à jour le compteur users.score_citoyen.
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';

export const POINTS_ACTIONS_CIVIQUES: Record<string, number> = {
  reunion: 20,
  atelier: 30,
  reunion_conseil: 15,
  nettoyage: 40,
  plantation: 35,
  maraude: 35,
  chantier: 50,
  aide_ponctuelle: 25,
};

export const BONUS_MEMBRE_ACTIF_CONSEIL = 50;
export const BONUS_VALIDATION_ELU = 10;
export const BONUS_REGULARITE_3_ACTIONS = 30;
export const BONUS_REGULARITE_6_MOIS = 75;
export const PENALITE_DESISTEMENT = 10;
export const POINTS_ORGANISER_ACTION = 100;
export const POINTS_SIGNALEMENT_RESOLU = 20;
export const PLAFOND_SIGNALEMENTS_SEMAINE = 5;
export const SEUIL_GEOFENCE_METRES = 150;
export const SEUIL_NO_SHOW_SUSPENSION = 3;
export const DUREE_SUSPENSION_JOURS = 15;

const RAISON_NO_SHOW = 'Absence non signalée (no-show)';
const RAISON_DESISTEMENT_TARDIF = 'Désistement tardif (moins de 24h avant l\'action)';
const RAISON_MEMBRE_CONSEIL = 'Devenu membre actif du conseil citoyen';
const RAISON_VALIDE_ELU = 'Bonus : validé par un élu';
const RAISON_ORGANISATION = 'Action organisée menée à terme';

const JOUR_MS = 24 * 3600 * 1000;

function ilYA(jours: number): string {
  return new Date(Date.now() - jours * JOUR_MS).toISOString();
}

// Exportée pour être testée isolément (voir test/points-citoyens.test.ts) — le rollover
// d'année (ex: moisPrecedent('2026-01') === '2025-12') est le genre de calcul qui casse
// silencieusement sans test dédié.
export function moisPrecedent(moisYYYYMM: string): string {
  const [an, mois] = moisYYYYMM.split('-').map(Number);
  const d = new Date(Date.UTC(an, mois - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// Pur : logique de dégressivité isolée de l'accès DB pour être testable sans mock.
// 1re-3e fois du même type d'action (fenêtre glissante 30j) = 100%, 4e-6e = 70%,
// 7e+ = 40% (plancher, jamais 0).
export function multiplicateurPourOccurrence(occurrence: number): number {
  if (occurrence <= 3) return 1;
  if (occurrence <= 6) return 0.7;
  return 0.4;
}

// Le filtre par type_action (dans la requête ci-dessous) fait naturellement office de
// réinitialisation "si l'utilisateur diversifie" — pas de logique de reset séparée à écrire.
export async function calculerMultiplicateurDegressif(env: any, commune_id: string, user_id: string, type_action: string): Promise<number> {
  const lignes = await supabaseSelect(env, 'points_citoyens_history', {
    select: 'id',
    commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, type_action: `eq.${type_action}`,
    type_mouvement: 'eq.gain', created_at: `gte.${ilYA(30)}`,
  });
  return multiplicateurPourOccurrence(lignes.length + 1); // +1 : celle qu'on est en train de créditer
}

// Primitive bas niveau : toute variation du score citoyen passe par ici (comme attribuerXp
// dans l'ancien système). Le score ne descend jamais sous 0.
export async function crediterScoreCitoyen(
  env: any, commune_id: string, user_id: string, montant_signe: number, raison: string,
  type_mouvement: 'gain' | 'penalite' | 'bonus',
  options: { event_id?: string; alerte_id?: string; type_action?: string; valide_par?: string } = {},
): Promise<void> {
  await supabaseInsert(env, 'points_citoyens_history', {
    commune_id, user_id, montant: montant_signe, raison, type_mouvement,
    event_id: options.event_id ?? null, alerte_id: options.alerte_id ?? null,
    type_action: options.type_action ?? null, valide_par: options.valide_par ?? null,
  });
  const [user] = await supabaseSelect(env, 'users', { select: 'score_citoyen', commune_id: `eq.${commune_id}`, id: `eq.${user_id}` });
  if (!user) return;
  const nouveauScore = Math.max(0, (user.score_citoyen ?? 0) + montant_signe);
  await supabaseUpdate(env, 'users', { score_citoyen: nouveauScore }, { id: `eq.${user_id}` });
}

// Appelée quand une présence passe à "confirme". Calcule le barème × dégressivité,
// gère les bonus associés (membre du conseil, validation élu), le streak et les badges.
export async function attribuerPointsParticipation(
  env: any, commune_id: string, user_id: string,
  event: { id: string; type_action: string },
  valideurRole: string, valideurId: string,
): Promise<{ points_gagnes: number; nouveaux_badges: string[] }> {
  const base = POINTS_ACTIONS_CIVIQUES[event.type_action];
  if (!base) return { points_gagnes: 0, nouveaux_badges: [] };

  const multiplicateur = await calculerMultiplicateurDegressif(env, commune_id, user_id, event.type_action);
  const points = Math.round(base * multiplicateur);

  await crediterScoreCitoyen(env, commune_id, user_id, points,
    `Présence validée : ${event.type_action}`, 'gain',
    { event_id: event.id, type_action: event.type_action, valide_par: valideurId });

  if (event.type_action === 'reunion_conseil') {
    const dejaMembre = await supabaseSelect(env, 'points_citoyens_history', {
      select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, raison: `eq.${RAISON_MEMBRE_CONSEIL}`,
    });
    if (dejaMembre.length === 0) {
      await crediterScoreCitoyen(env, commune_id, user_id, BONUS_MEMBRE_ACTIF_CONSEIL, RAISON_MEMBRE_CONSEIL, 'bonus', { event_id: event.id });
    }
  }

  // Le maire hérite de ce bonus (super-élu) — voir worker/src/lib/permissions.ts.
  if (['elu', 'maire'].includes(valideurRole)) {
    await crediterScoreCitoyen(env, commune_id, user_id, BONUS_VALIDATION_ELU, RAISON_VALIDE_ELU, 'bonus', { event_id: event.id, valide_par: valideurId });
  }

  await gererStreakParticipation(env, commune_id, user_id);
  const nouveauxBadges = await verifierBadgesCitoyens(env, commune_id, user_id);

  return { points_gagnes: points, nouveaux_badges: nouveauxBadges };
}

// Pur : incrémente le streak mensuel si le mois précédent était bien consécutif (rollover
// d'année compris via moisPrecedent), le réinitialise à 1 en cas de trou, ne change rien si
// une action a déjà été comptabilisée ce mois-ci.
export function calculerStreakMensuel(dernierMois: string | null | undefined, moisActuel: string, streakActuel: number): number {
  if (dernierMois === moisActuel) return streakActuel;
  if (dernierMois === moisPrecedent(moisActuel)) return streakActuel + 1;
  return 1;
}

// Streak "actions consécutives sans désistement" (pas une connexion quotidienne) + streak
// mensuel séparé pour le bonus de régularité longue durée (6 mois consécutifs).
export async function gererStreakParticipation(env: any, commune_id: string, user_id: string): Promise<void> {
  const [user] = await supabaseSelect(env, 'users', {
    select: 'streak_participation_actuel,streak_participation_record,streak_mensuel_citoyen_actuel,dernier_mois_action_citoyenne',
    commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return;

  const nouveauStreak = (user.streak_participation_actuel ?? 0) + 1;
  const nouveauRecord = Math.max(nouveauStreak, user.streak_participation_record ?? 0);

  const moisActuel = new Date().toISOString().slice(0, 7);
  const nouveauStreakMensuel = calculerStreakMensuel(
    user.dernier_mois_action_citoyenne, moisActuel, user.streak_mensuel_citoyen_actuel ?? 0,
  );

  await supabaseUpdate(env, 'users', {
    streak_participation_actuel: nouveauStreak,
    streak_participation_record: nouveauRecord,
    streak_mensuel_citoyen_actuel: nouveauStreakMensuel,
    dernier_mois_action_citoyenne: moisActuel,
  }, { id: `eq.${user_id}` });

  // Bonus régularité : redéclenchable à chaque nouvelle série de 3 actions consécutives
  // tenant dans une fenêtre de 90 jours (pas limité à une fois dans la vie).
  if (nouveauStreak === 3) {
    const recentes = await supabaseSelect(env, 'points_citoyens_history', {
      select: 'created_at', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
      type_mouvement: 'eq.gain', order: 'created_at.desc', limit: '3',
    });
    if (recentes.length === 3) {
      const plusAncienne = new Date(recentes[2].created_at).getTime();
      if (Date.now() - plusAncienne <= 90 * JOUR_MS) {
        await crediterScoreCitoyen(env, commune_id, user_id, BONUS_REGULARITE_3_ACTIONS,
          'Bonus régularité : 3 actions consécutives en moins de 3 mois', 'bonus');
      }
    }
  }
}

// Rompt une présence (no-show ou désistement tardif) : statut, pénalité, reset du streak
// par action (le streak record n'est jamais touché).
export async function romprePresenceCitoyenne(
  env: any, commune_id: string, user_id: string, participation: { id: string },
  motif: 'no_show' | 'desiste_tardif',
): Promise<void> {
  await supabaseUpdate(env, 'participations_citoyennes', { statut: motif }, { id: `eq.${participation.id}` });
  await crediterScoreCitoyen(env, commune_id, user_id, -PENALITE_DESISTEMENT,
    motif === 'no_show' ? RAISON_NO_SHOW : RAISON_DESISTEMENT_TARDIF, 'penalite');
  await supabaseUpdate(env, 'users', { streak_participation_actuel: 0 }, { id: `eq.${user_id}` });
}

// 3 no-show en 60 jours glissants → suspension de 15 jours des inscriptions à de nouvelles
// actions (pas de pénalité de points supplémentaire). N'écourte jamais une suspension existante.
export async function verifierSuspensionNoShow(env: any, commune_id: string, user_id: string): Promise<void> {
  const penalites = await supabaseSelect(env, 'points_citoyens_history', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
    type_mouvement: 'eq.penalite', raison: `eq.${RAISON_NO_SHOW}`, created_at: `gte.${ilYA(60)}`,
  });
  if (penalites.length < SEUIL_NO_SHOW_SUSPENSION) return;

  const [user] = await supabaseSelect(env, 'users', { select: 'suspendu_jusqu_au', commune_id: `eq.${commune_id}`, id: `eq.${user_id}` });
  const nouvelleDate = new Date(Date.now() + DUREE_SUSPENSION_JOURS * JOUR_MS);
  const dateActuelle = user?.suspendu_jusqu_au ? new Date(user.suspendu_jusqu_au) : null;
  if (dateActuelle && dateActuelle > nouvelleDate) return;
  await supabaseUpdate(env, 'users', { suspendu_jusqu_au: nouvelleDate.toISOString().slice(0, 10) }, { id: `eq.${user_id}` });
}

// Appelée depuis alertes.ts quand un signalement passe à "resolue". Idempotente par
// alerte (alerte_id est unique par ligne créditée) et plafonnée à 5 signalements/semaine.
export async function crediterSignalementResolu(env: any, commune_id: string, alerte: { id: string; user_id: string }): Promise<void> {
  const [dejaCredite] = await supabaseSelect(env, 'points_citoyens_history', {
    select: 'id', commune_id: `eq.${commune_id}`, alerte_id: `eq.${alerte.id}`,
  });
  if (dejaCredite) return;

  const recents = await supabaseSelect(env, 'points_citoyens_history', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${alerte.user_id}`,
    type_action: 'eq.signalement', created_at: `gte.${ilYA(7)}`,
  });
  if (recents.length >= PLAFOND_SIGNALEMENTS_SEMAINE) return;

  await crediterScoreCitoyen(env, commune_id, alerte.user_id, POINTS_SIGNALEMENT_RESOLU,
    'Signalement résolu par la mairie', 'gain', { alerte_id: alerte.id, type_action: 'signalement' });
  await verifierBadgesCitoyens(env, commune_id, alerte.user_id);
}

// Appelée par le cron de clôture. Idempotente par event (une seule ligne "organisation"
// par événement) et conditionnée à au moins une présence confirmée.
export async function crediterOrganisationAction(env: any, commune_id: string, event: { id: string; user_id: string }): Promise<void> {
  const [dejaCredite] = await supabaseSelect(env, 'points_citoyens_history', {
    select: 'id', commune_id: `eq.${commune_id}`, event_id: `eq.${event.id}`, raison: `eq.${RAISON_ORGANISATION}`,
  });
  if (dejaCredite) return;

  const [uneParticipationConfirmee] = await supabaseSelect(env, 'participations_citoyennes', {
    select: 'id', commune_id: `eq.${commune_id}`, event_id: `eq.${event.id}`, statut: 'eq.confirme', limit: '1',
  });
  if (!uneParticipationConfirmee) return;

  await crediterScoreCitoyen(env, commune_id, event.user_id, POINTS_ORGANISER_ACTION, RAISON_ORGANISATION, 'gain', { event_id: event.id });
  await verifierBadgesCitoyens(env, commune_id, event.user_id);
}

async function evaluerDeclencheur(
  env: any, commune_id: string, user_id: string, user: any,
  badge: { declencheur: string; valeur_seuil: number | null },
): Promise<boolean> {
  switch (badge.declencheur) {
    case 'score_citoyen':
      return badge.valeur_seuil != null && (user.score_citoyen ?? 0) >= badge.valeur_seuil;
    case 'streak_participation':
      return badge.valeur_seuil != null && (user.streak_participation_actuel ?? 0) >= badge.valeur_seuil;
    case 'streak_5_consecutives':
      return (user.streak_participation_actuel ?? 0) >= 5;
    case 'streak_mensuel_6':
      return (user.streak_mensuel_citoyen_actuel ?? 0) >= 6;
    case 'premier_signalement_resolu': {
      const [ligne] = await supabaseSelect(env, 'points_citoyens_history', {
        select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, type_action: 'eq.signalement', limit: '1',
      });
      return !!ligne;
    }
    case 'premiere_action_organisee': {
      const [ligne] = await supabaseSelect(env, 'points_citoyens_history', {
        select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, raison: `eq.${RAISON_ORGANISATION}`, limit: '1',
      });
      return !!ligne;
    }
    case 'valide_par_elu': {
      const [ligne] = await supabaseSelect(env, 'points_citoyens_history', {
        select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, raison: `eq.${RAISON_VALIDE_ELU}`, limit: '1',
      });
      return !!ligne;
    }
    default:
      return false;
  }
}

// Équivalent DB-driven de verifierBadges (gamification.ts) — badges gérés par le
// superadmin plutôt que codés en dur. Le bonus des 6 mois consécutifs est crédité au
// moment exact où le badge streak_mensuel_6 se débloque (idempotent via UNIQUE(user_id,badge_id)).
export async function verifierBadgesCitoyens(env: any, commune_id: string, user_id: string): Promise<string[]> {
  const badges = await supabaseSelect(env, 'badges_citoyens', {
    select: 'id,cle,declencheur,valeur_seuil', commune_id: `eq.${commune_id}`, actif: 'eq.true',
  });
  if (!badges.length) return [];

  const dejaObtenus = await supabaseSelect(env, 'user_badges_citoyens', {
    select: 'badge_id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
  });
  const idsDejaObtenus = new Set(dejaObtenus.map((b: any) => b.badge_id));
  const aEvaluer = badges.filter((b: any) => !idsDejaObtenus.has(b.id));
  if (!aEvaluer.length) return [];

  const [user] = await supabaseSelect(env, 'users', {
    select: 'score_citoyen,streak_participation_actuel,streak_mensuel_citoyen_actuel',
    commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return [];

  const nouveaux: string[] = [];
  for (const badge of aEvaluer) {
    const debloque = await evaluerDeclencheur(env, commune_id, user_id, user, badge);
    if (!debloque) continue;
    await supabaseInsert(env, 'user_badges_citoyens', { commune_id, user_id, badge_id: badge.id });
    nouveaux.push(badge.cle);
    if (badge.declencheur === 'streak_mensuel_6') {
      await crediterScoreCitoyen(env, commune_id, user_id, BONUS_REGULARITE_6_MOIS,
        'Bonus régularité : 6 mois consécutifs avec au moins une action validée', 'bonus');
    }
  }
  return nouveaux;
}

// Pur : logique de recherche de palier isolée de l'accès DB pour être testable sans mock.
// Seule donnée de progression exposée au client — jamais la formule de dégressivité.
export function trouverPalier(paliers: { nom: string; seuil: number }[], score: number): {
  actuel: { nom: string; seuil: number } | null;
  suivant: { nom: string; seuil: number } | null;
  progression_pct: number;
} {
  if (!paliers.length) return { actuel: null, suivant: null, progression_pct: 0 };

  let actuel: { nom: string; seuil: number } | null = null;
  let suivant: { nom: string; seuil: number } | null = null;
  for (const palier of paliers) {
    if (score >= palier.seuil) actuel = palier;
    else { suivant = palier; break; }
  }

  if (!suivant) return { actuel, suivant: null, progression_pct: 100 };
  const seuilBas = actuel ? actuel.seuil : 0;
  const pct = Math.min(100, Math.round(((score - seuilBas) / (suivant.seuil - seuilBas)) * 100));
  return { actuel, suivant, progression_pct: pct };
}

export async function calculerPalierCourant(env: any, commune_id: string, score: number): Promise<{
  actuel: { nom: string; seuil: number } | null;
  suivant: { nom: string; seuil: number } | null;
  progression_pct: number;
}> {
  const paliers = await supabaseSelect(env, 'paliers_citoyens', {
    select: 'nom,seuil', commune_id: `eq.${commune_id}`, order: 'seuil.asc',
  });
  return trouverPalier(paliers, score);
}

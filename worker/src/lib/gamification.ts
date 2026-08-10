// worker/src/lib/gamification.ts
// Toute attribution d'XP passe EXCLUSIVEMENT par ce fichier, appelé depuis les routes
// après qu'une action légitime a été validée côté serveur. Le client ne peut jamais
// déclencher ces fonctions directement — il n'existe aucune route "POST /xp".
import { supabaseSelect, supabaseUpdate, supabaseInsert } from '../db';

export const XP_ACTIONS = {
  connexion_quotidienne: 5,
  publier_post: 10,
  voter_sondage: 5,
  signaler_alerte: 10,
  participer_evenement: 5,
  valider_etape_chasse: 20,
  publier_annonce: 5,
  valider_photo: 1,
  signalement_confirme: 15,
  trouver_enigme: 15,
  lire_article: 1,
  lire_loi: 1,
  voter_loi: 5,
  evenement_succes: 15,
};

// Progression triangulaire : niveau n atteint à partir de 50*n*(n+1)/2 XP cumulés.
export function xpRequisPourNiveau(niveau: number): number {
  return 50 * niveau * (niveau + 1) / 2;
}

export function niveauDepuisXp(xp: number): number {
  let n = 1;
  while (xp >= xpRequisPourNiveau(n)) n++;
  return n;
}

export async function attribuerXp(env: any, commune_id: string, user_id: string, montant: number): Promise<{ xp_gagne: number; nouveaux_badges: string[]; niveau: number; monte_de_niveau: boolean }> {
  const [user] = await supabaseSelect(env, 'users', {
    select: 'xp', commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return { xp_gagne: 0, nouveaux_badges: [], niveau: 1, monte_de_niveau: false };
  const ancienXp = user.xp ?? 0;
  const nouveauXp = ancienXp + montant;
  const niveauAvant = niveauDepuisXp(ancienXp);
  const nouveauNiveau = niveauDepuisXp(nouveauXp);
  await supabaseUpdate(env, 'users', { xp: nouveauXp, niveau: nouveauNiveau }, { id: `eq.${user_id}` });
  const nouveauxBadges = await verifierBadges(env, commune_id, user_id);
  return { xp_gagne: montant, nouveaux_badges: nouveauxBadges, niveau: nouveauNiveau, monte_de_niveau: nouveauNiveau > niveauAvant };
}

// Incrémente un compteur permanent sur le profil (ex: validations_donnees, signalements_confirmes).
// Ces compteurs ne sont jamais recalculés en comptant des lignes, car ces dernières
// sont purgées régulièrement (photos éphémères) — seul un compteur persistant est fiable
// pour des badges à progression longue.
export async function incrementerCompteurUtilisateur(env: any, commune_id: string, user_id: string, colonne: string, montant = 1) {
  const [user] = await supabaseSelect(env, 'users', {
    select: colonne, commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return;
  const nouvelleValeur = (user[colonne] ?? 0) + montant;
  await supabaseUpdate(env, 'users', { [colonne]: nouvelleValeur }, { id: `eq.${user_id}` });
}

export async function gererConnexionQuotidienne(env: any, commune_id: string, user_id: string) {
  const [user] = await supabaseSelect(env, 'users', {
    select: 'streak_actuel,streak_record,derniere_connexion_streak',
    commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return;

  const aujourdhui = new Date().toISOString().slice(0, 10);
  if (user.derniere_connexion_streak === aujourdhui) return; // déjà comptabilisée aujourd'hui

  let nouveauStreak = 1;
  if (user.derniere_connexion_streak) {
    const hier = new Date();
    hier.setDate(hier.getDate() - 1);
    if (user.derniere_connexion_streak === hier.toISOString().slice(0, 10)) {
      nouveauStreak = (user.streak_actuel ?? 0) + 1;
    }
  }
  const nouveauRecord = Math.max(nouveauStreak, user.streak_record ?? 0);

  await supabaseUpdate(env, 'users', {
    streak_actuel: nouveauStreak, streak_record: nouveauRecord, derniere_connexion_streak: aujourdhui,
  }, { id: `eq.${user_id}` });

  await attribuerXp(env, commune_id, user_id, XP_ACTIONS.connexion_quotidienne);
}

// Série "exploration" : jours consécutifs avec au moins une action d'exploration
// (valider une étape de chasse, créer ou résoudre une énigme photo). Indépendante
// de la série de connexion quotidienne — un jour de connexion sans explorer ne compte pas.
export async function gererStreakExploration(env: any, commune_id: string, user_id: string) {
  const [user] = await supabaseSelect(env, 'users', {
    select: 'streak_exploration_actuel,streak_exploration_record,derniere_action_exploration',
    commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return;

  const aujourdhui = new Date().toISOString().slice(0, 10);
  if (user.derniere_action_exploration === aujourdhui) return; // déjà comptabilisé aujourd'hui

  let nouveauStreak = 1;
  if (user.derniere_action_exploration) {
    const hier = new Date();
    hier.setDate(hier.getDate() - 1);
    if (user.derniere_action_exploration === hier.toISOString().slice(0, 10)) {
      nouveauStreak = (user.streak_exploration_actuel ?? 0) + 1;
    }
  }
  const nouveauRecord = Math.max(nouveauStreak, user.streak_exploration_record ?? 0);

  await supabaseUpdate(env, 'users', {
    streak_exploration_actuel: nouveauStreak, streak_exploration_record: nouveauRecord,
    derniere_action_exploration: aujourdhui,
  }, { id: `eq.${user_id}` });

  await verifierBadges(env, commune_id, user_id);
}

// Définitions des badges — chaque condition est vérifiée côté serveur, jamais fournie par le client.
const DEFINITIONS_BADGES = [
  { cle: 'premier_pas', verifie: async () => true }, // acquis dès la 1re vérification (après 1re connexion)
  { cle: 'assidu', verifie: async (_env: any, _cid: string, _uid: string, user: any) => (user.streak_actuel ?? 0) >= 7 },
  { cle: 'super_assidu', verifie: async (_env: any, _cid: string, _uid: string, user: any) => (user.streak_actuel ?? 0) >= 30 },
  { cle: 'pilier_du_village', verifie: async (_env: any, _cid: string, _uid: string, user: any) => (user.niveau ?? 1) >= 5 },
  {
    cle: 'sentinelle',
    verifie: async (env: any, commune_id: string, user_id: string) => {
      const alertes = await supabaseSelect(env, 'alertes', {
        select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
      });
      return alertes.length >= 5;
    },
  },
  {
    cle: 'voisin_solidaire',
    verifie: async (env: any, commune_id: string, user_id: string) => {
      const annonces = await supabaseSelect(env, 'coups_de_main', {
        select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
      });
      return annonces.length >= 3;
    },
  },
  // Progression longue sur les validations de "Photo du jour" — compteur permanent,
  // volontairement étalée (5 → 1000) pour récompenser un engagement dans la durée.
  { cle: 'premier_regard', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.validations_donnees ?? 0) >= 5 },
  { cle: 'oeil_aiguise', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.validations_donnees ?? 0) >= 20 },
  { cle: 'curateur_quartier', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.validations_donnees ?? 0) >= 50 },
  { cle: 'curateur_village', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.validations_donnees ?? 0) >= 150 },
  { cle: 'grand_curateur', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.validations_donnees ?? 0) >= 500 },
  { cle: 'legende_galerie', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.validations_donnees ?? 0) >= 1000 },
  // Récompense les signalements qui se révèlent fondés (photo effectivement supprimée par un gestionnaire).
  { cle: 'protecteur_village', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.signalements_confirmes ?? 0) >= 3 },
  // Progression sur "Trouve la photo" — compteur permanent d'énigmes résolues.
  { cle: 'explorateur_debutant', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.enigmes_trouvees ?? 0) >= 3 },
  { cle: 'explorateur_confirme', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.enigmes_trouvees ?? 0) >= 10 },
  { cle: 'grand_explorateur', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.enigmes_trouvees ?? 0) >= 25 },
  // Progression sur les étapes de Chasse au trésor validées (compteur permanent).
  { cle: 'chercheur_tresor', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.etapes_chasse_validees ?? 0) >= 5 },
  { cle: 'maitre_chasseur', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.etapes_chasse_validees ?? 0) >= 20 },
  { cle: 'legende_tresor', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.etapes_chasse_validees ?? 0) >= 50 },
  // Terminer une chasse à 100% au moins une fois (distinct du simple cumul d'étapes).
  { cle: 'finisseur', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.chasses_terminees ?? 0) >= 1 },
  // Série d'exploration : 5 jours d'affilée avec au moins une action (chasse ou énigme).
  { cle: 'explorateur_assidu', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.streak_exploration_actuel ?? 0) >= 5 },
  // Badge capstone : récompense d'avoir vraiment pratiqué les DEUX jeux d'exploration, pas un seul.
  {
    cle: 'maitre_exploration',
    verifie: async (_e: any, _c: string, _u: string, user: any) =>
      (user.etapes_chasse_validees ?? 0) >= 20 && (user.enigmes_trouvees ?? 0) >= 10,
  },
  // Progression sur les articles lus (compteur permanent).
  { cle: 'lecteur_assidu', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.articles_lus ?? 0) >= 10 },
  { cle: 'grand_lecteur', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.articles_lus ?? 0) >= 50 },
  { cle: 'erudit_village', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.articles_lus ?? 0) >= 150 },
  // Progression sur l'organisation d'événements Agenda (compteur permanent).
  { cle: 'organisateur_debutant', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.evenements_crees ?? 0) >= 3 },
  { cle: 'grand_organisateur', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.evenements_crees ?? 0) >= 10 },
  { cle: 'pilier_evenements', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.evenements_crees ?? 0) >= 25 },
  // Au moins un événement organisé a atteint le seuil de succès (voir SEUIL_EVENEMENT_SUCCES).
  { cle: 'evenement_reussi', verifie: async (_e: any, _c: string, _u: string, user: any) => (user.evenements_reussis ?? 0) >= 1 },
];

export async function verifierBadges(env: any, commune_id: string, user_id: string): Promise<string[]> {
  const [user] = await supabaseSelect(env, 'users', {
    select: 'xp,niveau,streak_actuel,streak_record,validations_donnees,signalements_confirmes,enigmes_trouvees,etapes_chasse_validees,chasses_terminees,streak_exploration_actuel,streak_exploration_record,articles_lus,evenements_crees,evenements_reussis',
    commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return [];

  const dejaObtenus = await supabaseSelect(env, 'badges_obtenus', {
    select: 'cle_badge', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
  });
  const clesDejaObtenues = new Set(dejaObtenus.map((b: any) => b.cle_badge));

  const nouveaux: string[] = [];
  for (const def of DEFINITIONS_BADGES) {
    if (clesDejaObtenues.has(def.cle)) continue;
    if (await def.verifie(env, commune_id, user_id, user)) {
      await supabaseInsert(env, 'badges_obtenus', { commune_id, user_id, cle_badge: def.cle });
      nouveaux.push(def.cle);
    }
  }
  return nouveaux;
}

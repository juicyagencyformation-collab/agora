// worker/src/lib/badges-parcours.ts
// Badges de parcours (2026-11-15, migration 104) : la mairie peut offrir un badge à ceux qui
// terminent une chasse au trésor ou une balade ; il est COPIÉ dans badges_parcours à l'obtention
// (il survit à une modification ou un archivage du parcours). En plus, un grand badge du village
// est gagné automatiquement en terminant tous les parcours publiés d'une commune (au moins 2) ;
// il monte d'un niveau chaque fois que la personne termine de nouveau tout ce qui est publié après
// que la mairie a ajouté des parcours (sinon il ne servirait plus à rien une fois gagné).
// Anti-farming (règle n°6) : un badge par personne et par parcours, un grand badge par personne et
// par village — contraintes UNIQUE en base + contrôle ici. Jamais d'XP lié à ces badges.
import { z } from 'zod';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../db';

// Listes fermées, recopiées dans frontend/js/badges-parcours.js (ICONES_BADGE, METAUX_BADGE).
export const ICONES_BADGE = ['🏰', '⛪', '🕊️', '🌾', '🦆', '🐟', '🌉', '⚓', '🌳', '🍎', '🗝️', '🧭', '🏛️', '⛲', '🚲', '🌻'] as const;
export const METAUX_BADGE = ['or', 'argent', 'bronze', 'somme', 'prairie', 'brique'] as const;
export const ICONE_GRAND_BADGE = '🏆';
export const PARCOURS_MIN_GRAND_BADGE = 2;

export const badgeSchema = z.object({
  nom: z.string().trim().min(1).max(40),
  icone: z.enum(ICONES_BADGE),
  metal: z.enum(METAUX_BADGE),
  phrase: z.string().trim().max(90).optional(),
});
export type ReglageBadge = z.infer<typeof badgeSchema>;

export const COLONNES_BADGE_CHASSE = 'badge_nom,badge_icone,badge_metal,badge_phrase';

// Colonnes à écrire sur chasses_tresor. undefined = ne pas toucher (client qui n'envoie pas le
// champ) ; null = retirer le badge.
export function colonnesBadge(badge: ReglageBadge | null | undefined) {
  if (badge === undefined) return {};
  if (badge === null) return { badge_nom: null, badge_icone: null, badge_metal: null, badge_phrase: null };
  return { badge_nom: badge.nom, badge_icone: badge.icone, badge_metal: badge.metal, badge_phrase: badge.phrase || null };
}

// « Connaisseur d'Eaucourt-sur-Somme », « Connaisseur du Crotoy », « Connaisseur de Tourly ».
export function nomGrandBadge(village: string): string {
  const v = village.trim();
  if (/^le\s/i.test(v)) return `Connaisseur du ${v.slice(3)}`;
  if (/^les\s/i.test(v)) return `Connaisseur des ${v.slice(4)}`;
  if (/^[aeiouyhâàäéèêëîïôöûüœ]/i.test(v) && !/^l['’]/i.test(v)) return `Connaisseur d'${v}`;
  return `Connaisseur de ${v}`;
}

// Parcours publiés d'une commune et ceux que la personne a terminés (toutes les étapes validées,
// points de passage compris).
export async function etatParcoursVillage(env: any, commune_id: string, user_id: string) {
  const actifs = await supabaseSelect(env, 'chasses_tresor', {
    select: `id,titre,${COLONNES_BADGE_CHASSE}`,
    commune_id: `eq.${commune_id}`, actif: 'eq.true', order: 'created_at.asc',
  });
  const termines = new Set<string>();
  if (!actifs.length) return { actifs, termines };
  const ids = `in.(${actifs.map((ch: any) => ch.id).join(',')})`;
  const [etapes, progressions] = await Promise.all([
    supabaseSelect(env, 'etapes_chasse', { select: 'chasse_id', commune_id: `eq.${commune_id}`, chasse_id: ids }),
    supabaseSelect(env, 'progressions_chasse', { select: 'chasse_id', commune_id: `eq.${commune_id}`, chasse_id: ids, user_id: `eq.${user_id}` }),
  ]);
  const compter = (lignes: any[]) => lignes.reduce((m: Map<string, number>, l: any) => m.set(l.chasse_id, (m.get(l.chasse_id) ?? 0) + 1), new Map());
  const nbEtapes = compter(etapes);
  const nbValidees = compter(progressions);
  for (const ch of actifs) {
    const total = nbEtapes.get(ch.id) ?? 0;
    if (total > 0 && (nbValidees.get(ch.id) ?? 0) >= total) termines.add(ch.id);
  }
  return { actifs, termines };
}

async function infosCommune(env: any, commune_id: string): Promise<{ nom: string; slug: string }> {
  const [commune] = await supabaseSelect(env, 'communes', { select: 'nom,slug', id: `eq.${commune_id}` });
  return { nom: commune?.nom ?? '', slug: commune?.slug ?? '' };
}

// Insère un badge gagné ; le rang est le nombre de personnes qui l'ont déjà + 1. Renvoie null si
// la personne l'a déjà (ou si la contrainte UNIQUE refuse un double envoi simultané).
async function enregistrerBadge(env: any, ligne: Record<string, any>, filtreDejaObtenus: Record<string, string>) {
  const dejaObtenus = await supabaseSelect(env, 'badges_parcours', { select: 'user_id', ...filtreDejaObtenus });
  if (dejaObtenus.some((b: any) => b.user_id === ligne.user_id)) return null;
  const complete = { ...ligne, rang: dejaObtenus.length + 1 };
  try {
    await supabaseInsert(env, 'badges_parcours', complete);
  } catch {
    return null;
  }
  return complete;
}

const projectionBadge = (b: Record<string, any>, village_slug: string) => ({
  type: b.type, nom: b.nom, icone: b.icone, metal: b.metal, phrase: b.phrase ?? null,
  village_nom: b.village_nom, village_slug, parcours_titre: b.parcours_titre ?? null, rang: b.rang ?? null,
  niveau: b.niveau ?? 1, ameliore_le: b.ameliore_le ?? null,
});
const phraseGrandBadge = (nbParcours: number) => `Les ${nbParcours} parcours du village, tous terminés.`;

// Appelée quand une personne vient de terminer un parcours (dernière étape validée).
// commune_joueur = commune du compte ; commune_parcours = commune du parcours (voir
// finaliserValidationEtape). Renvoie les badges gagnés, à animer côté téléphone.
export async function attribuerBadgesFinParcours(env: any, commune_joueur: string, commune_parcours: string, user_id: string, chasse_id: string) {
  const [chasse] = await supabaseSelect(env, 'chasses_tresor', {
    select: `id,titre,${COLONNES_BADGE_CHASSE}`, id: `eq.${chasse_id}`, commune_id: `eq.${commune_parcours}`,
  });
  if (!chasse) return [];
  const { nom: village, slug } = await infosCommune(env, commune_parcours);
  const gagnes: Record<string, any>[] = [];

  if (chasse.badge_nom) {
    const badge = await enregistrerBadge(env, {
      commune_id: commune_joueur, user_id, commune_parcours_id: commune_parcours, type: 'parcours', chasse_id,
      nom: chasse.badge_nom, icone: chasse.badge_icone, metal: chasse.badge_metal, phrase: chasse.badge_phrase ?? null,
      village_nom: village, parcours_titre: chasse.titre,
    }, { chasse_id: `eq.${chasse_id}` });
    if (badge) gagnes.push(badge);
  }

  const { actifs, termines } = await etatParcoursVillage(env, commune_parcours, user_id);
  if (actifs.length >= PARCOURS_MIN_GRAND_BADGE && termines.size === actifs.length) {
    const [existant] = await supabaseSelect(env, 'badges_parcours', {
      select: 'id,commune_id,nom,icone,metal,village_nom,rang,niveau,created_at',
      user_id: `eq.${user_id}`, commune_parcours_id: `eq.${commune_parcours}`, type: 'eq.village',
    });
    if (!existant) {
      const grand = await enregistrerBadge(env, {
        commune_id: commune_joueur, user_id, commune_parcours_id: commune_parcours, type: 'village', chasse_id: null,
        nom: nomGrandBadge(village), icone: ICONE_GRAND_BADGE, metal: 'or',
        phrase: phraseGrandBadge(actifs.length), village_nom: village, parcours_titre: null, niveau: 1,
      }, { commune_parcours_id: `eq.${commune_parcours}`, type: 'eq.village' });
      if (grand) gagnes.push(grand);
    } else {
      // Grand badge déjà gagné : la personne vient de terminer un parcours qu'elle n'avait pas fait
      // (un parcours ne se termine qu'une fois) et tout est de nouveau terminé → un niveau de plus.
      // Une seule mise à jour, jamais une nouvelle ligne (UNIQUE par village).
      const amelioration = { niveau: (existant.niveau ?? 1) + 1, ameliore_le: new Date().toISOString(), phrase: phraseGrandBadge(actifs.length) };
      await supabaseUpdate(env, 'badges_parcours', amelioration, { id: `eq.${existant.id}`, commune_id: `eq.${existant.commune_id}` });
      gagnes.push({ ...existant, ...amelioration, type: 'village', parcours_titre: null, ameliore: true });
    }
  }
  return gagnes.map((b) => ({ ...projectionBadge(b, slug), ...(b.ameliore ? { ameliore: true } : {}) }));
}

// Aperçu pour le mode test des gestionnaires : le badge que verrait un joueur, sans rien écrire.
export async function apercuBadgeParcours(env: any, commune_id: string, chasse: Record<string, any>) {
  if (!chasse.badge_nom) return [];
  const { nom, slug } = await infosCommune(env, commune_id);
  return [projectionBadge({
    type: 'parcours', nom: chasse.badge_nom, icone: chasse.badge_icone, metal: chasse.badge_metal,
    phrase: chasse.badge_phrase, village_nom: nom, parcours_titre: chasse.titre, rang: null,
  }, slug)];
}

// Collection du profil : badges gagnés (ici et ailleurs), parcours de MA commune qui offrent un
// badge pas encore gagné (silhouettes), et progression vers le grand badge du village.
export async function collectionParcours(env: any, commune_id: string, user_id: string) {
  const [badges, etat, village] = await Promise.all([
    supabaseSelect(env, 'badges_parcours', {
      select: 'id,type,chasse_id,commune_parcours_id,nom,icone,metal,phrase,village_nom,parcours_titre,rang,niveau,ameliore_le,created_at',
      commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, order: 'created_at.asc',
    }),
    etatParcoursVillage(env, commune_id, user_id),
    infosCommune(env, commune_id),
  ]);
  // Slugs des villages des badges (lien de la carte partagée), en une requête.
  const autresIds = [...new Set(badges.map((b: any) => b.commune_parcours_id))].filter((id) => id !== commune_id);
  const slugs = new Map<string, string>([[commune_id, village.slug]]);
  if (autresIds.length) {
    const autres = await supabaseSelect(env, 'communes', { select: 'id,slug', id: `in.(${autresIds.join(',')})` });
    for (const a of autres) slugs.set(a.id, a.slug);
  }
  const obtenus = new Set(badges.map((b: any) => b.chasse_id).filter(Boolean));
  const a_decouvrir = etat.actifs
    .filter((ch: any) => ch.badge_nom && !obtenus.has(ch.id))
    .map((ch: any) => ({ chasse_id: ch.id, parcours_titre: ch.titre }));
  const grandObtenu = badges.find((b: any) => b.type === 'village' && b.commune_parcours_id === commune_id);
  return {
    badges: badges.map((b: any) => ({ id: b.id, created_at: b.created_at, ...projectionBadge(b, slugs.get(b.commune_parcours_id) ?? '') })),
    a_decouvrir,
    grand_badge: etat.actifs.length >= PARCOURS_MIN_GRAND_BADGE ? {
      nom: nomGrandBadge(village.nom), village_nom: village.nom, icone: ICONE_GRAND_BADGE, metal: 'or',
      total: etat.actifs.length, termines: etat.termines.size, obtenu: !!grandObtenu, niveau: grandObtenu?.niveau ?? 0,
    } : null,
  };
}

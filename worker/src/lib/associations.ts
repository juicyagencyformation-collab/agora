// worker/src/lib/associations.ts
// Espace des associations (migration 101) : un habitant « responsable actif » d'une fiche de
// l'annuaire la tient à jour à la place de la mairie. Partagé entre routes/annuaire.ts et les
// deux chemins d'anonymisation de compte (auth.ts, backoffice/administration.ts) — et, au lot 2,
// les publications d'actualités / d'événements au nom d'une association.
import { supabaseSelect, supabaseUpdate, supabaseDelete, supabaseInsert } from '../db';
import { estGestionnaire } from './permissions';

export type StatutResponsable = 'actif' | 'demande' | null;

// Lot 2 (migration 102) : au plus 3 publications (actualités + événements) par association sur
// 24 h glissantes, pour un responsable. La mairie publiant pour une association n'est pas limitée.
export const MAX_PUBLICATIONS_ASSO_24H = 3;

// Même règle que requireOngletActif : pas de ligne = actif. L'annuaire est dans l'offre payante
// (décision de Léandre du 2026-11-10) : sans lui, aucune publication au nom d'une association,
// même si actualités et agenda (gratuits) restent ouverts.
async function annuaireActif(env: any, commune_id: string): Promise<boolean> {
  const [row] = await supabaseSelect(env, 'onglets_config', {
    select: 'actif', commune_id: `eq.${commune_id}`, cle: 'eq.annuaire',
  });
  return row?.actif !== false;
}

// Publier (ou gérer une publication) au nom d'une fiche : association de la commune, annuaire
// actif, et mairie ou responsable actif de cette fiche.
export async function peutPublierPourFiche(env: any, commune_id: string, fiche_id: string, user_id: string, role: string): Promise<boolean> {
  const [fiche] = await supabaseSelect(env, 'annuaire', {
    select: 'id,categorie', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}`,
  });
  if (fiche?.categorie !== 'association') return false;
  if (!(await annuaireActif(env, commune_id))) return false;
  if (estGestionnaire(role)) return true;
  return (await statutResponsable(env, commune_id, fiche_id, user_id)) === 'actif';
}

export async function plafondPublicationsAssoAtteint(env: any, commune_id: string, fiche_id: string): Promise<boolean> {
  const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const filtres = { select: 'id', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}`, created_at: `gte.${depuis}` };
  const [articles, events] = await Promise.all([
    supabaseSelect(env, 'articles', filtres),
    supabaseSelect(env, 'events', filtres),
  ]);
  return articles.length + events.length >= MAX_PUBLICATIONS_ASSO_24H;
}

// Associations au nom desquelles l'utilisateur peut publier (menu « Publier pour » des
// formulaires) : toutes celles de la commune pour la mairie, ses fiches gérées sinon.
export async function fichesPublicationPossible(env: any, commune_id: string, user_id: string, role: string) {
  if (!(await annuaireActif(env, commune_id))) return [];
  const filtres: Record<string, string> = {
    select: 'id,nom,logo_url', commune_id: `eq.${commune_id}`, categorie: 'eq.association', order: 'nom.asc',
  };
  if (!estGestionnaire(role)) {
    const ids = await idsFichesGerees(env, commune_id, user_id);
    if (!ids.length) return [];
    filtres.id = `in.(${ids.join(',')})`;
  }
  return supabaseSelect(env, 'annuaire', filtres);
}

export async function idsFichesGerees(env: any, commune_id: string, user_id: string): Promise<string[]> {
  const lignes = await supabaseSelect(env, 'annuaire_responsables', {
    select: 'fiche_id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, statut: 'eq.actif',
  });
  return lignes.map((l: any) => l.fiche_id);
}

// Nom + logo des associations citées dans une liste de publications (une seule requête).
export async function fichesAffichage(env: any, commune_id: string, ids: string[]): Promise<Map<string, any>> {
  const uniques = [...new Set(ids.filter(Boolean))];
  if (!uniques.length) return new Map();
  const fiches = await supabaseSelect(env, 'annuaire', {
    select: 'id,nom,logo_url', commune_id: `eq.${commune_id}`, id: `in.(${uniques.join(',')})`,
  });
  return new Map(fiches.map((f: any) => [f.id, f]));
}

// Règle n°4 : un signalement masque aussitôt, la mairie revoit. Un habitant ne compte qu'une
// fois par publication (UNIQUE en base, vérifié ici pour ne pas lever d'erreur).
export async function signalerPublication(env: any, commune_id: string, user_id: string, cible: { article_id?: string; event_id?: string }) {
  const table = cible.article_id ? 'articles' : 'events';
  const id = (cible.article_id ?? cible.event_id) as string;
  const colonne = cible.article_id ? 'article_id' : 'event_id';
  const [existant] = await supabaseSelect(env, 'publications_signalements', {
    select: 'id', commune_id: `eq.${commune_id}`, [colonne]: `eq.${id}`, user_id: `eq.${user_id}`,
  });
  if (!existant) await supabaseInsert(env, 'publications_signalements', { commune_id, user_id, [colonne]: id });
  await supabaseUpdate(env, table, { statut: 'masquee' }, { id: `eq.${id}`, commune_id: `eq.${commune_id}` });
}

export async function statutResponsable(env: any, commune_id: string, fiche_id: string, user_id: string): Promise<StatutResponsable> {
  const [ligne] = await supabaseSelect(env, 'annuaire_responsables', {
    select: 'statut', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}`, user_id: `eq.${user_id}`,
  });
  return ligne?.statut ?? null;
}

// À appeler AVANT la suppression des fiches de l'annuaire d'un compte anonymisé (qui efface
// les fiches dont il est le créateur) : il cesse d'être responsable de quoi que ce soit, et une
// fiche d'association qu'il avait créée mais qu'un autre responsable actif a reprise (changement
// de bureau) est détachée de son compte au lieu d'être effacée avec lui.
export async function detacherFichesAssociations(env: any, commune_id: string, user_ids: string[]) {
  if (!user_ids.length) return;
  const ids = `in.(${user_ids.join(',')})`;
  await supabaseDelete(env, 'annuaire_responsables', { user_id: ids, commune_id: `eq.${commune_id}` });

  const fiches = await supabaseSelect(env, 'annuaire', {
    select: 'id', user_id: ids, commune_id: `eq.${commune_id}`, categorie: 'eq.association',
  });
  if (!fiches.length) return;
  const reprises = await supabaseSelect(env, 'annuaire_responsables', {
    select: 'fiche_id', commune_id: `eq.${commune_id}`, statut: 'eq.actif',
    fiche_id: `in.(${fiches.map((f: any) => f.id).join(',')})`,
  });
  const idsRepris = [...new Set(reprises.map((r: any) => r.fiche_id))];
  if (!idsRepris.length) return;
  await supabaseUpdate(env, 'annuaire', { user_id: null }, {
    id: `in.(${idsRepris.join(',')})`, commune_id: `eq.${commune_id}`,
  });
}

// worker/src/lib/associations.ts
// Espace des associations (migration 101) : un habitant « responsable actif » d'une fiche de
// l'annuaire la tient à jour à la place de la mairie. Partagé entre routes/annuaire.ts et les
// deux chemins d'anonymisation de compte (auth.ts, backoffice/administration.ts) — et, au lot 2,
// les publications d'actualités / d'événements au nom d'une association.
import { supabaseSelect, supabaseUpdate, supabaseDelete, supabaseInsert } from '../db';
import { estGestionnaire } from './permissions';

export type StatutResponsable = 'actif' | 'demande' | null;

// Fiches de l'annuaire qui peuvent publier (actualités, événements) par leurs responsables validés :
// associations (migration 102) puis commerces et artisans (2026-11-26, migration 122).
export const CATEGORIES_PUBLIANTES = ['association', 'commerce', 'artisan'] as const;
export const estFichePubliante = (categorie: string | null | undefined) => (CATEGORIES_PUBLIANTES as readonly string[]).includes(categorie ?? '');

// Quotas par fiche, pour un responsable (la mairie n'est pas limitée) :
// - association : 3 publications sur 24 h glissantes (lot 2, migration 102) ;
// - commerce, artisan : 2 publications sur 7 jours glissants (décision de Léandre, 2026-11-26),
//   contre la publicité en rafale.
export const MAX_PUBLICATIONS_ASSO_24H = 3;
export const QUOTAS_PUBLICATION: Record<string, { max: number; jours: number; libelle: string }> = {
  association: { max: 3, jours: 1, libelle: '3 publications par association sur 24 heures' },
  commerce: { max: 2, jours: 7, libelle: '2 publications par commerce sur 7 jours' },
  artisan: { max: 2, jours: 7, libelle: '2 publications par artisan sur 7 jours' },
};

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
// Suspension décidée par la mairie (migration 122) : en cours jusqu'à la date incluse.
export const suspensionEnCours = (fiche: { publications_suspendues_jusqu?: string | null }) =>
  !!fiche?.publications_suspendues_jusqu && fiche.publications_suspendues_jusqu >= new Date().toISOString().slice(0, 10);

export async function peutPublierPourFiche(env: any, commune_id: string, fiche_id: string, user_id: string, role: string): Promise<boolean> {
  const [fiche] = await supabaseSelect(env, 'annuaire', {
    select: 'id,categorie,publications_suspendues_jusqu', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}`,
  });
  if (!fiche || !estFichePubliante(fiche.categorie)) return false;
  if (!(await annuaireActif(env, commune_id))) return false;
  if (estGestionnaire(role)) return true;
  if (suspensionEnCours(fiche)) return false;
  return (await statutResponsable(env, commune_id, fiche_id, user_id)) === 'actif';
}

// Message d'erreur si le quota de la fiche est atteint, sinon null.
export async function plafondPublicationsAtteint(env: any, commune_id: string, fiche_id: string): Promise<string | null> {
  const [fiche] = await supabaseSelect(env, 'annuaire', { select: 'categorie', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}` });
  const quota = QUOTAS_PUBLICATION[fiche?.categorie] ?? QUOTAS_PUBLICATION.association;
  const depuis = new Date(Date.now() - quota.jours * 24 * 3600 * 1000).toISOString();
  const filtres = { select: 'id', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}`, created_at: `gte.${depuis}` };
  const [articles, events] = await Promise.all([
    supabaseSelect(env, 'articles', filtres),
    supabaseSelect(env, 'events', filtres),
  ]);
  return articles.length + events.length >= quota.max ? `Limite atteinte : ${quota.libelle}.` : null;
}

// Ancien nom (associations seules), gardé pour les appels existants.
export async function plafondPublicationsAssoAtteint(env: any, commune_id: string, fiche_id: string): Promise<boolean> {
  return (await plafondPublicationsAtteint(env, commune_id, fiche_id)) !== null;
}

// Associations au nom desquelles l'utilisateur peut publier (menu « Publier pour » des
// formulaires) : toutes celles de la commune pour la mairie, ses fiches gérées sinon.
export async function fichesPublicationPossible(env: any, commune_id: string, user_id: string, role: string) {
  if (!(await annuaireActif(env, commune_id))) return [];
  const filtres: Record<string, string> = {
    select: 'id,nom,logo_url,categorie,publications_suspendues_jusqu', commune_id: `eq.${commune_id}`,
    categorie: `in.(${CATEGORIES_PUBLIANTES.join(',')})`, order: 'nom.asc',
  };
  if (!estGestionnaire(role)) {
    const ids = await idsFichesGerees(env, commune_id, user_id);
    if (!ids.length) return [];
    filtres.id = `in.(${ids.join(',')})`;
  }
  const fiches = await supabaseSelect(env, 'annuaire', filtres);
  // Une fiche suspendue par la mairie ne propose plus la publication à ses responsables.
  return estGestionnaire(role) ? fiches : fiches.filter((f: any) => !suspensionEnCours(f));
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
    select: 'id,nom,logo_url,categorie', commune_id: `eq.${commune_id}`, id: `in.(${uniques.join(',')})`,
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
    select: 'id', user_id: ids, commune_id: `eq.${commune_id}`, categorie: `in.(${CATEGORIES_PUBLIANTES.join(',')})`,
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

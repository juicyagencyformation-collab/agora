// worker/src/lib/associations.ts
// Espace des associations (migration 101) : un habitant « responsable actif » d'une fiche de
// l'annuaire la tient à jour à la place de la mairie. Partagé entre routes/annuaire.ts et les
// deux chemins d'anonymisation de compte (auth.ts, backoffice/administration.ts) — et, au lot 2,
// les publications d'actualités / d'événements au nom d'une association.
import { supabaseSelect, supabaseUpdate, supabaseDelete } from '../db';

export type StatutResponsable = 'actif' | 'demande' | null;

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

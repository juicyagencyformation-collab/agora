// worker/src/lib/nom-public.ts
// Nom d'un habitant tel qu'affiché aux AUTRES habitants sur ses publications : "Léandre S." par
// défaut, ou "Un habitant" / "Une habitante" s'il a choisi l'anonymat (users.affichage_nom).
// L'intéressé voit toujours son propre nom complet. Ne PAS utiliser dans les outils de gestion
// (modération, contacts d'événement, validation de présence, backoffice) : la mairie, responsable
// du traitement, doit pouvoir identifier l'auteur d'un contenu.
export const COLONNES_NOM_PUBLIC = 'id,prenom,nom,affichage_nom';

export function nomPublic(u: any, lecteurId?: string): { prenom: string; nom: string } {
  if (!u) return { prenom: '?', nom: '' };
  if (lecteurId && u.id === lecteurId) return { prenom: u.prenom ?? '?', nom: u.nom ?? '' };
  if (u.affichage_nom === 'habitant') return { prenom: 'Un habitant', nom: '' };
  if (u.affichage_nom === 'habitante') return { prenom: 'Une habitante', nom: '' };
  const initiale = (u.nom ?? '').trim().charAt(0).toUpperCase();
  return { prenom: u.prenom ?? '?', nom: initiale ? `${initiale}.` : '' };
}

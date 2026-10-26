// worker/src/lib/nom-public.ts
// Nom d'un habitant tel qu'affiché sur ses publications : "Léandre S." par défaut, ou "Anonyme"
// s'il l'a choisi (users.affichage_nom). Un libellé plutôt qu'un vide : un nom absent laisserait
// des trous ("Organisé par", "1." dans un classement) pris pour un bug.
// L'auteur voit ses propres publications EXACTEMENT comme les autres, suivi de "(vous)" : s'il
// voyait son nom complet, il ne comprendrait pas que les autres voient "Anonyme" (retour d'une
// habitante, 2026-10-26).
// Ne PAS utiliser dans les outils de gestion (modération, contacts d'événement, validation de
// présence, backoffice) : la mairie, responsable du traitement, doit pouvoir identifier l'auteur.
export const COLONNES_NOM_PUBLIC = 'id,prenom,nom,affichage_nom';

export function nomPublic(u: any, lecteurId?: string): { prenom: string; nom: string } {
  if (!u) return { prenom: '?', nom: '' };
  let affiche: { prenom: string; nom: string };
  if (u.affichage_nom && u.affichage_nom !== 'initiale') {
    affiche = { prenom: 'Anonyme', nom: '' };
  } else {
    const initiale = (u.nom ?? '').trim().charAt(0).toUpperCase();
    affiche = { prenom: u.prenom ?? '?', nom: initiale ? `${initiale}.` : '' };
  }
  if (lecteurId && u.id === lecteurId) affiche.nom = [affiche.nom, '(vous)'].filter(Boolean).join(' ');
  return affiche;
}

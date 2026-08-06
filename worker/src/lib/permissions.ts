// worker/src/lib/permissions.ts
// Hiérarchie des rôles :
// - citoyen      : aucun pouvoir de gestion
// - admin        : créer / modifier / supprimer du contenu
// - élu          : mêmes pouvoirs de contenu qu'admin + peut nommer/révoquer des admins
// - maire        : mêmes pouvoirs qu'élu + peut nommer/révoquer des élus (le vrai maire de
//                  la commune, distinct d'un simple conseiller municipal/élu) + upload du
//                  logo de la commune. Un seul par commune par convention, jamais imposé
//                  techniquement — attribué uniquement par le superadmin.
// - superadmin   : mêmes pouvoirs que maire + peut nommer/révoquer des maires
//
// Le rôle "superadmin" lui-même n'est jamais attribuable via l'interface (sécurité :
// évite qu'une erreur de code ou un compte compromis puisse créer un autre superadmin).

const ROLES_GESTIONNAIRES = ['admin', 'elu', 'maire', 'superadmin'];
const ROLES_PEUVENT_GERER_ROLES = ['elu', 'maire', 'superadmin'];
const ROLES_ATTRIBUABLES = ['citoyen', 'admin', 'elu', 'maire'];

export function estGestionnaire(role: string): boolean {
  return ROLES_GESTIONNAIRES.includes(role);
}

export function peutGererRoles(role: string): boolean {
  return ROLES_PEUVENT_GERER_ROLES.includes(role);
}

// Vérifie qu'un rôle appelant a le droit d'attribuer un rôle cible à un utilisateur donné.
export function peutAttribuerRole(roleAppelant: string, roleCibleActuel: string, nouveauRole: string): { ok: boolean; erreur?: string } {
  if (!ROLES_ATTRIBUABLES.includes(nouveauRole)) {
    return { ok: false, erreur: 'Rôle invalide ou non attribuable' };
  }
  if (!peutGererRoles(roleAppelant)) {
    return { ok: false, erreur: 'Non autorisé à modifier les rôles' };
  }
  // Un élu ne peut jamais toucher un élu, le maire ou un superadmin, ni nommer un élu ou un maire
  if (roleAppelant === 'elu') {
    if (['elu', 'maire', 'superadmin'].includes(roleCibleActuel)) {
      return { ok: false, erreur: 'Un élu ne peut pas modifier un élu, le maire ou un superadmin' };
    }
    if (['elu', 'maire'].includes(nouveauRole)) {
      return { ok: false, erreur: 'Seuls le maire et le superadmin peuvent nommer un élu' };
    }
  }
  // Le maire hérite des pouvoirs d'un élu et peut en plus nommer/révoquer des élus, mais ne
  // peut toucher ni un autre maire ni un superadmin, ni nommer un maire (un seul par
  // commune par convention, jamais entre pairs — réservé au superadmin)
  if (roleAppelant === 'maire') {
    if (['maire', 'superadmin'].includes(roleCibleActuel)) {
      return { ok: false, erreur: 'Le maire ne peut pas modifier un autre maire ou un superadmin' };
    }
    if (nouveauRole === 'maire') {
      return { ok: false, erreur: 'Seul le superadmin peut nommer un maire' };
    }
  }
  // Un superadmin ne peut pas modifier un autre superadmin via cette route
  if (roleAppelant === 'superadmin' && roleCibleActuel === 'superadmin') {
    return { ok: false, erreur: 'Action non autorisée sur un compte superadmin' };
  }
  return { ok: true };
}

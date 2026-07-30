// worker/src/lib/permissions.ts
// Hiérarchie des rôles :
// - citoyen      : aucun pouvoir de gestion
// - admin        : créer / modifier / supprimer du contenu
// - élu          : mêmes pouvoirs de contenu qu'admin + peut nommer/révoquer des admins
// - superadmin   : mêmes pouvoirs qu'élu + peut nommer/révoquer des élus
//
// Le rôle "superadmin" lui-même n'est jamais attribuable via l'interface (sécurité :
// évite qu'une erreur de code ou un compte compromis puisse créer un autre superadmin).

const ROLES_GESTIONNAIRES = ['admin', 'elu', 'superadmin'];
const ROLES_PEUVENT_GERER_ROLES = ['elu', 'superadmin'];
const ROLES_ATTRIBUABLES = ['citoyen', 'admin', 'elu'];

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
  // Un élu ne peut jamais toucher un élu ou un superadmin, ni nommer un élu
  if (roleAppelant === 'elu') {
    if (['elu', 'superadmin'].includes(roleCibleActuel)) {
      return { ok: false, erreur: 'Un élu ne peut pas modifier un élu ou un superadmin' };
    }
    if (nouveauRole === 'elu') {
      return { ok: false, erreur: 'Seul le superadmin peut nommer un élu' };
    }
  }
  // Un superadmin ne peut pas modifier un autre superadmin via cette route
  if (roleAppelant === 'superadmin' && roleCibleActuel === 'superadmin') {
    return { ok: false, erreur: 'Action non autorisée sur un compte superadmin' };
  }
  return { ok: true };
}

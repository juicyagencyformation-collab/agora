// worker/test/permissions.test.ts
import { describe, it, expect } from 'vitest';
import { estGestionnaire, peutGererRoles, peutAttribuerRole } from '../src/lib/permissions';

describe('estGestionnaire', () => {
  it('un citoyen n\'est jamais gestionnaire', () => {
    expect(estGestionnaire('citoyen')).toBe(false);
  });
  it('admin, élu, maire et superadmin sont gestionnaires', () => {
    expect(estGestionnaire('admin')).toBe(true);
    expect(estGestionnaire('elu')).toBe(true);
    expect(estGestionnaire('maire')).toBe(true);
    expect(estGestionnaire('superadmin')).toBe(true);
  });
});

describe('peutGererRoles', () => {
  it('seuls élu, maire et superadmin peuvent gérer les rôles', () => {
    expect(peutGererRoles('citoyen')).toBe(false);
    expect(peutGererRoles('admin')).toBe(false);
    expect(peutGererRoles('elu')).toBe(true);
    expect(peutGererRoles('maire')).toBe(true);
    expect(peutGererRoles('superadmin')).toBe(true);
  });
});

describe('peutAttribuerRole — le cœur du modèle de sécurité', () => {
  it('un citoyen ne peut jamais attribuer de rôle', () => {
    const resultat = peutAttribuerRole('citoyen', 'citoyen', 'admin');
    expect(resultat.ok).toBe(false);
  });

  it('un admin ne peut jamais attribuer de rôle', () => {
    const resultat = peutAttribuerRole('admin', 'citoyen', 'admin');
    expect(resultat.ok).toBe(false);
  });

  it('un élu peut nommer un citoyen admin', () => {
    const resultat = peutAttribuerRole('elu', 'citoyen', 'admin');
    expect(resultat.ok).toBe(true);
  });

  it('un élu ne peut PAS nommer quelqu\'un élu', () => {
    const resultat = peutAttribuerRole('elu', 'citoyen', 'elu');
    expect(resultat.ok).toBe(false);
  });

  it('un élu ne peut PAS toucher à un autre élu', () => {
    const resultat = peutAttribuerRole('elu', 'elu', 'admin');
    expect(resultat.ok).toBe(false);
  });

  it('un élu ne peut PAS toucher à un superadmin', () => {
    const resultat = peutAttribuerRole('elu', 'superadmin', 'admin');
    expect(resultat.ok).toBe(false);
  });

  it('un superadmin peut nommer un élu', () => {
    const resultat = peutAttribuerRole('superadmin', 'citoyen', 'elu');
    expect(resultat.ok).toBe(true);
  });

  it('un superadmin ne peut jamais attribuer le rôle superadmin (jamais via l\'interface)', () => {
    const resultat = peutAttribuerRole('superadmin', 'citoyen', 'superadmin');
    expect(resultat.ok).toBe(false);
  });

  it('un superadmin ne peut pas modifier un autre superadmin', () => {
    const resultat = peutAttribuerRole('superadmin', 'superadmin', 'admin');
    expect(resultat.ok).toBe(false);
  });

  it('rejette un rôle cible invalide/inventé', () => {
    const resultat = peutAttribuerRole('superadmin', 'citoyen', 'roi-du-village');
    expect(resultat.ok).toBe(false);
  });
});

describe('peutAttribuerRole — le rôle maire (nouveau palier entre élu et superadmin)', () => {
  it('un élu ne peut PAS nommer quelqu\'un maire', () => {
    const resultat = peutAttribuerRole('elu', 'citoyen', 'maire');
    expect(resultat.ok).toBe(false);
  });

  it('un élu ne peut PAS toucher au maire', () => {
    const resultat = peutAttribuerRole('elu', 'maire', 'admin');
    expect(resultat.ok).toBe(false);
  });

  it('un superadmin peut nommer un maire', () => {
    const resultat = peutAttribuerRole('superadmin', 'citoyen', 'maire');
    expect(resultat.ok).toBe(true);
  });

  it('le maire hérite des pouvoirs d\'un élu : peut nommer un citoyen admin', () => {
    const resultat = peutAttribuerRole('maire', 'citoyen', 'admin');
    expect(resultat.ok).toBe(true);
  });

  it('le maire peut nommer un élu (contrairement à un simple élu)', () => {
    const resultat = peutAttribuerRole('maire', 'citoyen', 'elu');
    expect(resultat.ok).toBe(true);
  });

  it('le maire ne peut PAS nommer un autre maire (réservé au superadmin)', () => {
    const resultat = peutAttribuerRole('maire', 'citoyen', 'maire');
    expect(resultat.ok).toBe(false);
  });

  it('le maire ne peut PAS toucher un autre maire', () => {
    const resultat = peutAttribuerRole('maire', 'maire', 'admin');
    expect(resultat.ok).toBe(false);
  });

  it('le maire ne peut PAS toucher un superadmin', () => {
    const resultat = peutAttribuerRole('maire', 'superadmin', 'admin');
    expect(resultat.ok).toBe(false);
  });
});

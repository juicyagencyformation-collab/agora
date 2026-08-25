// worker/test/prospection-ab.test.ts
// Couvre gererVariantesProspectionAutomatiquement (voir src/backoffice/prospection-ab.ts) : la
// SEULE fonction du projet autorisée à basculer une variante d'email toute seule (exception
// documentée et délibérée à la règle "l'activation est un choix explicite"), donc à tester avec
// le même sérieux qu'onboarding-drip.test.ts, dont le mock Supabase/Resend en mémoire est repris
// ici (étendu au PATCH, utilisé par supabaseUpdate pour (dés)activer une variante).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gererVariantesProspectionAutomatiquement } from '../src/backoffice/prospection-ab';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let emailsEnvoyesResend: { to: string; subject: string }[];

function reinitialiserDb() {
  db = { envois_prospection: [], prospects: [], users: [], modeles_email: [], journal_activite: [] };
  emailsEnvoyesResend = [];
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre === 'not.is.null') return valeur !== null && valeur !== undefined;
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  return true;
}

function appliquerFiltres(table: Ligne[], params: URLSearchParams): Ligne[] {
  let lignes = [...table];
  for (const [cle, valeur] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  return lignes;
}

function fetchFake(input: any, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const methode = init?.method || 'GET';

  if (url.hostname === 'api.resend.com') {
    const corps = JSON.parse(String(init!.body));
    emailsEnvoyesResend.push({ to: corps.to, subject: corps.subject });
    return Promise.resolve(new Response(JSON.stringify({ id: 'resend-test-id' }), { status: 200 }));
  }

  const table = url.pathname.replace('/rest/v1/', '');
  if (methode === 'GET') {
    return Promise.resolve(new Response(JSON.stringify(appliquerFiltres(db[table] || [], url.searchParams)), { status: 200 }));
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init!.body));
    const ligne = { id: crypto.randomUUID(), ...corps };
    (db[table] ??= []).push(ligne);
    return Promise.resolve(new Response(JSON.stringify([ligne]), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init!.body));
    const ciblees = appliquerFiltres(db[table] || [], url.searchParams);
    for (const ligne of ciblees) Object.assign(ligne, corps);
    return Promise.resolve(new Response(JSON.stringify(ciblees), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  RESEND_API_KEY: 'fake-resend-key',
  EMAIL_FROM: 'Agora <test@plateforme-agora.fr>',
};

function ajouterVariante(nom: string, actif = false): Ligne {
  const v = { id: crypto.randomUUID(), cle: 'presentation', nom, actif };
  db.modeles_email.push(v);
  return v;
}

// Ajoute `n` envois pour une variante, avec un taux de rejet/ouverture donné, à une ancienneté
// donnée (mature = ≥7j par défaut, pour que envoyes_matures compte ces lignes).
function ajouterEnvois(variante: string, n: number, opts: { rejet?: number; ouverture?: number; joursAnciennete?: number } = {}) {
  const { rejet = 0, ouverture = 0, joursAnciennete = 10 } = opts;
  const envoyeLe = new Date(Date.now() - joursAnciennete * 24 * 3600 * 1000).toISOString();
  const nRejetes = Math.round(n * rejet);
  const nOuverts = Math.round(n * ouverture);
  for (let i = 0; i < n; i++) {
    db.envois_prospection.push({
      id: crypto.randomUUID(), prospect_id: null, variante, envoye_le: envoyeLe, est_test: false,
      rejete_le: i < nRejetes ? envoyeLe : null,
      ouvert_le: i < nOuverts ? envoyeLe : null,
      clique_le: null,
    });
  }
}

beforeEach(() => {
  reinitialiserDb();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gardes-fous de base', () => {
  it('ne fait rien avec une seule variante (rien à comparer)', async () => {
    ajouterVariante('Variante A', true);
    ajouterEnvois('Variante A', 100, { rejet: 0.5 });

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.nom === 'Variante A')!.actif).toBe(true);
    expect(emailsEnvoyesResend).toEqual([]);
  });

  it('ne fait rien si aucune variante n\'est marquée active', async () => {
    ajouterVariante('Variante A', false);
    ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 100, { rejet: 0.5 });
    ajouterEnvois('Variante B', 100, { rejet: 0.05 });

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.every((v) => !v.actif)).toBe(true);
    expect(emailsEnvoyesResend).toEqual([]);
  });

  it('ne bascule pas pour rejet élevé si le volume de la variante active est sous le seuil (50)', async () => {
    ajouterVariante('Variante A', true);
    ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 40, { rejet: 0.9 }); // catastrophique mais trop peu de volume pour juger
    ajouterEnvois('Variante B', 100, { rejet: 0.05 });

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.nom === 'Variante A')!.actif).toBe(true);
    expect(emailsEnvoyesResend).toEqual([]);
  });
});

describe('bascule d\'urgence — rejet élevé sur la variante active', () => {
  it('bascule vers la meilleure alternative sûre, journalise et alerte par email', async () => {
    const a = ajouterVariante('Variante A', true);
    const b = ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 100, { rejet: 0.31 }); // > 25%, > seuil de volume (50)
    ajouterEnvois('Variante B', 100, { rejet: 0.09, ouverture: 0.3 });

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(false);
    expect(db.modeles_email.find((v) => v.id === b.id)!.actif).toBe(true);
    expect(db.journal_activite).toHaveLength(1);
    expect(db.journal_activite[0].action).toBe('variante_prospection_basculee_urgence');
    expect(db.journal_activite[0].staff_id).toBeNull();
    expect(emailsEnvoyesResend).toHaveLength(1);
    expect(emailsEnvoyesResend[0].subject).toContain('changée automatiquement');
  });

  it('n\'ignore pas une alternative dont le volume est sous le seuil (30), même avec un excellent taux', async () => {
    const a = ajouterVariante('Variante A', true);
    ajouterVariante('Variante C', false);
    ajouterEnvois('Variante A', 100, { rejet: 0.31 });
    ajouterEnvois('Variante C', 10, { rejet: 0.0, ouverture: 0.9 }); // trop peu de volume pour être une bascule sûre

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(true); // pas de bascule
    expect(emailsEnvoyesResend).toHaveLength(1);
    expect(emailsEnvoyesResend[0].subject).toContain('aucune alternative sûre');
  });

  it('alerte sans basculer si aucune autre variante n\'a un rejet sous le seuil non plus', async () => {
    const a = ajouterVariante('Variante A', true);
    ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 100, { rejet: 0.31 });
    ajouterEnvois('Variante B', 100, { rejet: 0.4 }); // pire encore

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(true);
    expect(db.journal_activite).toEqual([]); // pas d'action à journaliser, juste une alerte
    expect(emailsEnvoyesResend[0].subject).toContain('aucune alternative sûre');
  });

  it('choisit la meilleure alternative sûre par taux d\'ouverture mature quand plusieurs sont éligibles', async () => {
    const a = ajouterVariante('Variante A', true);
    const b = ajouterVariante('Variante B', false);
    const c = ajouterVariante('Variante C', false);
    ajouterEnvois('Variante A', 100, { rejet: 0.31 });
    ajouterEnvois('Variante B', 100, { rejet: 0.1, ouverture: 0.2 });
    ajouterEnvois('Variante C', 100, { rejet: 0.1, ouverture: 0.5 }); // meilleure ouverture

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === c.id)!.actif).toBe(true);
    expect(db.modeles_email.find((v) => v.id === b.id)!.actif).toBe(false);
    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(false);
  });
});

describe('promotion du gagnant — pas d\'urgence, une variante mature bat clairement l\'active', () => {
  it('promeut une variante avec un écart d\'ouverture mature ≥ 8 points', async () => {
    const a = ajouterVariante('Variante A', true);
    const b = ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 150, { rejet: 0.1, ouverture: 0.2, joursAnciennete: 10 }); // 20% mature
    ajouterEnvois('Variante B', 150, { rejet: 0.1, ouverture: 0.3, joursAnciennete: 10 }); // 30% mature, +10 pts

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(false);
    expect(db.modeles_email.find((v) => v.id === b.id)!.actif).toBe(true);
    expect(db.journal_activite[0].action).toBe('variante_prospection_promue');
    expect(emailsEnvoyesResend[0].subject).toContain('promue automatiquement');
  });

  it('ne promeut pas si l\'écart est sous le seuil de 8 points', async () => {
    const a = ajouterVariante('Variante A', true);
    ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 150, { rejet: 0.1, ouverture: 0.25, joursAnciennete: 10 });
    ajouterEnvois('Variante B', 150, { rejet: 0.1, ouverture: 0.30, joursAnciennete: 10 }); // +5 pts seulement

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(true);
    expect(emailsEnvoyesResend).toEqual([]);
  });

  it('ne promeut pas tant que la variante active elle-même n\'a pas assez de volume mature (100)', async () => {
    const a = ajouterVariante('Variante A', true);
    ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 60, { rejet: 0.1, ouverture: 0.2, joursAnciennete: 10 }); // sous le seuil de maturité
    ajouterEnvois('Variante B', 150, { rejet: 0.1, ouverture: 0.5, joursAnciennete: 10 });

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(true);
    expect(emailsEnvoyesResend).toEqual([]);
  });

  it('ignore un candidat non mature (envois trop récents), même avec un excellent taux brut', async () => {
    const a = ajouterVariante('Variante A', true);
    ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 150, { rejet: 0.1, ouverture: 0.2, joursAnciennete: 10 });
    ajouterEnvois('Variante B', 150, { rejet: 0.05, ouverture: 0.9, joursAnciennete: 1 }); // envoyée hier, pas mature

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(true); // B ignorée, pas assez mature
    expect(emailsEnvoyesResend).toEqual([]);
  });

  it('ne promeut jamais une variante dont le rejet dépasse le seuil de danger, même très ouverte', async () => {
    const a = ajouterVariante('Variante A', true);
    ajouterVariante('Variante B', false);
    ajouterEnvois('Variante A', 150, { rejet: 0.1, ouverture: 0.2, joursAnciennete: 10 });
    ajouterEnvois('Variante B', 150, { rejet: 0.3, ouverture: 0.9, joursAnciennete: 10 }); // rejet trop haut malgré l'ouverture

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.modeles_email.find((v) => v.id === a.id)!.actif).toBe(true);
  });
});

describe('priorité : au plus une action par passage', () => {
  it('traite l\'urgence (rejet) et ignore la promotion dans le même passage', async () => {
    const a = ajouterVariante('Variante A', true);
    const b = ajouterVariante('Variante B', false);
    // A est à la fois en danger (rejet) ET B la battrait largement en ouverture mature —
    // seule la bascule d'urgence doit se produire (une seule action, un seul email).
    ajouterEnvois('Variante A', 150, { rejet: 0.31, ouverture: 0.1, joursAnciennete: 10 });
    ajouterEnvois('Variante B', 150, { rejet: 0.05, ouverture: 0.5, joursAnciennete: 10 });

    await gererVariantesProspectionAutomatiquement(ENV);

    expect(db.journal_activite).toHaveLength(1);
    expect(db.journal_activite[0].action).toBe('variante_prospection_basculee_urgence');
    expect(emailsEnvoyesResend).toHaveLength(1);
  });
});

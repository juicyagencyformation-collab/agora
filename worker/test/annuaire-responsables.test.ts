// worker/test/annuaire-responsables.test.ts
// Espace des associations (migration 101) : un habitant demande à gérer une fiche d'association,
// la mairie valide ; un responsable actif modifie la fiche mais pas sa catégorie, ne la supprime
// pas ; tout reste cloisonné par commune ; un compte anonymisé ne gère plus rien et une fiche
// reprise par un autre responsable survit à l'anonymisation de son créateur.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import annuaire from '../src/routes/annuaire';
import { detacherFichesAssociations } from '../src/lib/associations';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET, R2_PUBLIC_BASE: 'https://cdn.test' };
const FAUX_EXECUTION_CTX = { waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {} };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre === 'is.null') return valeur == null;
  if (filtre.startsWith('ilike.')) {
    // Vrai comportement de ILIKE : % et _ sont des jokers, sauf échappés par « \ ».
    const regex = filtre.slice(6).replace(/\\([\\%_])|([%_])|([^\\%_]+)/g, (_m, echappe, joker, texte) =>
      echappe ? echappe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : joker ? (joker === '%' ? '.*' : '.')
        : texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^${regex}$`, 'i').test(String(valeur));
  }
  return true;
}
const filtrer = (table: Ligne[], p: URLSearchParams) =>
  table.filter((l) => [...p.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || correspond(l[k], v)));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') return Promise.resolve(new Response(JSON.stringify(filtrer(db[table] || [], url.searchParams)), { status: 200 }));
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const lignes = (Array.isArray(corps) ? corps : [corps]).map((l) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...lignes);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const visees = filtrer(db[table] || [], url.searchParams);
    visees.forEach((l) => Object.assign(l, JSON.parse(String(init.body))));
    return Promise.resolve(new Response(JSON.stringify(visees), { status: 200 }));
  }
  if (methode === 'DELETE') {
    const visees = new Set(filtrer(db[table] || [], url.searchParams));
    db[table] = (db[table] || []).filter((l) => !visees.has(l));
    return Promise.resolve(new Response('[]', { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const cookie = async (user_id: string, role: string, commune_id = 'c1') => ({
  Cookie: `agora_access=${await sign({ user_id, commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
});
const appel = async (chemin: string, methode: string, user_id: string, role: string, corps?: object, commune_id = 'c1') =>
  annuaire.request(chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(await cookie(user_id, role, commune_id)) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  }, ENV, FAUX_EXECUTION_CTX);

beforeEach(() => {
  db = {
    annuaire: [
      { id: 'f-asso', commune_id: 'c1', user_id: null, nom: 'Comité des fêtes', categorie: 'association' },
      { id: 'f-commerce', commune_id: 'c1', user_id: null, nom: 'Boulangerie', categorie: 'commerce' },
      { id: 'f-autre-commune', commune_id: 'c2', user_id: null, nom: 'Club de foot', categorie: 'association' },
    ],
    annuaire_documents: [],
    annuaire_responsables: [],
    users: [
      { id: 'u-pres', commune_id: 'c1', prenom: 'Paul', nom: 'Martin', email: 'paul.martin@exemple.fr', role: 'citoyen', compte_supprime_le: null },
      { id: 'u-autre', commune_id: 'c1', prenom: 'Anne', nom: 'Petit', email: 'anne_p@exemple.fr', role: 'citoyen', compte_supprime_le: null },
      { id: 'u-maire', commune_id: 'c1', prenom: 'Marie', nom: 'Durand', email: 'maire@exemple.fr', role: 'maire', compte_supprime_le: null },
    ],
    push_subscriptions: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Demande « Je fais partie du bureau »', () => {
  it('crée une demande en attente, sans droit de modification avant validation', async () => {
    expect((await appel('/f-asso/responsables/demande', 'POST', 'u-pres', 'citoyen')).status).toBe(201);
    expect(db.annuaire_responsables[0]).toMatchObject({ commune_id: 'c1', fiche_id: 'f-asso', user_id: 'u-pres', statut: 'demande' });
    expect((await appel('/f-asso', 'PATCH', 'u-pres', 'citoyen', { description: 'Fête le 14 juillet' })).status).toBe(403);
  });
  it('refuse une seconde demande sur la même fiche', async () => {
    await appel('/f-asso/responsables/demande', 'POST', 'u-pres', 'citoyen');
    expect((await appel('/f-asso/responsables/demande', 'POST', 'u-pres', 'citoyen')).status).toBe(409);
    expect(db.annuaire_responsables).toHaveLength(1);
  });
  it('refuse une fiche qui n\'est pas une association', async () => {
    expect((await appel('/f-commerce/responsables/demande', 'POST', 'u-pres', 'citoyen')).status).toBe(404);
  });
  it('refuse une association d\'une autre commune (cloisonnement)', async () => {
    expect((await appel('/f-autre-commune/responsables/demande', 'POST', 'u-pres', 'citoyen')).status).toBe(404);
    expect(db.annuaire_responsables).toHaveLength(0);
  });
  it('plafonne les demandes en attente', async () => {
    db.annuaire.push(...['a', 'b', 'c', 'd'].map((x) => ({ id: `f-${x}`, commune_id: 'c1', user_id: null, nom: x, categorie: 'association' })));
    for (const x of ['a', 'b', 'c']) expect((await appel(`/f-${x}/responsables/demande`, 'POST', 'u-pres', 'citoyen')).status).toBe(201);
    expect((await appel('/f-d/responsables/demande', 'POST', 'u-pres', 'citoyen')).status).toBe(429);
  });
});

describe('Validation par la mairie', () => {
  it('un habitant ne peut pas valider sa propre demande', async () => {
    await appel('/f-asso/responsables/demande', 'POST', 'u-pres', 'citoyen');
    const rid = db.annuaire_responsables[0].id;
    expect((await appel(`/f-asso/responsables/${rid}`, 'PATCH', 'u-pres', 'citoyen')).status).toBe(403);
    expect(db.annuaire_responsables[0].statut).toBe('demande');
  });
  it('la mairie valide : le responsable modifie la fiche, mais ni sa catégorie ni sa suppression', async () => {
    await appel('/f-asso/responsables/demande', 'POST', 'u-pres', 'citoyen');
    const rid = db.annuaire_responsables[0].id;
    expect((await appel(`/f-asso/responsables/${rid}`, 'PATCH', 'u-maire', 'maire')).status).toBe(200);
    expect(db.annuaire_responsables[0]).toMatchObject({ statut: 'actif', valide_par: 'u-maire' });

    const res = await appel('/f-asso', 'PATCH', 'u-pres', 'citoyen', { description: 'Fête le 14 juillet', categorie: 'service_public' });
    expect(res.status).toBe(200);
    const fiche = db.annuaire.find((f) => f.id === 'f-asso')!;
    expect(fiche.description).toBe('Fête le 14 juillet');
    expect(fiche.categorie).toBe('association');

    expect((await appel('/f-asso', 'DELETE', 'u-pres', 'citoyen')).status).toBe(403);
    expect(db.annuaire.some((f) => f.id === 'f-asso')).toBe(true);
  });
  it('la mairie d\'une autre commune ne peut pas valider', async () => {
    await appel('/f-asso/responsables/demande', 'POST', 'u-pres', 'citoyen');
    const rid = db.annuaire_responsables[0].id;
    expect((await appel(`/f-asso/responsables/${rid}`, 'PATCH', 'u-maire-c2', 'maire', undefined, 'c2')).status).toBe(404);
    expect(db.annuaire_responsables[0].statut).toBe('demande');
  });
  it('la liste n\'expose pas qui gère quoi aux habitants', async () => {
    db.annuaire_responsables.push({ id: 'r1', commune_id: 'c1', fiche_id: 'f-asso', user_id: 'u-pres', statut: 'actif' });
    const corps: any = await (await appel('/', 'GET', 'u-autre', 'citoyen')).json();
    const asso = corps.fiches.find((f: any) => f.id === 'f-asso');
    expect(asso).toMatchObject({ tenue_par_association: true, mon_statut_responsable: null });
    expect(JSON.stringify(corps)).not.toContain('u-pres');
    expect(corps.demandes_en_attente).toEqual([]);
    expect((await appel('/f-asso/responsables', 'GET', 'u-autre', 'citoyen')).status).toBe(403);
  });
});

describe('Désignation directe par email', () => {
  it('ajoute un habitant inscrit comme responsable actif', async () => {
    expect((await appel('/f-asso/responsables', 'POST', 'u-maire', 'maire', { email: 'Paul.Martin@exemple.fr' })).status).toBe(201);
    expect(db.annuaire_responsables[0]).toMatchObject({ user_id: 'u-pres', statut: 'actif', valide_par: 'u-maire' });
  });
  it('un « _ » dans l\'adresse ne désigne jamais quelqu\'un d\'autre', async () => {
    expect((await appel('/f-asso/responsables', 'POST', 'u-maire', 'maire', { email: 'anne_p@exemple.fr' })).status).toBe(201);
    expect(db.annuaire_responsables[0].user_id).toBe('u-autre');
    // Seul « annexp@ » est inscrit : « anne_p@ » ne doit pas le trouver via le joker « _ ».
    db.annuaire_responsables = [];
    db.users = db.users.filter((u) => u.id !== 'u-autre');
    db.users.push({ id: 'u-x', commune_id: 'c1', prenom: 'X', nom: 'Y', email: 'annexp@exemple.fr', role: 'citoyen', compte_supprime_le: null });
    expect((await appel('/f-asso/responsables', 'POST', 'u-maire', 'maire', { email: 'anne_p@exemple.fr' })).status).toBe(404);
  });
  it('refuse un habitant d\'une autre commune et un simple habitant appelant', async () => {
    db.users.push({ id: 'u-c2', commune_id: 'c2', prenom: 'Luc', nom: 'B', email: 'luc@exemple.fr', role: 'citoyen', compte_supprime_le: null });
    expect((await appel('/f-asso/responsables', 'POST', 'u-maire', 'maire', { email: 'luc@exemple.fr' })).status).toBe(404);
    expect((await appel('/f-asso/responsables', 'POST', 'u-autre', 'citoyen', { email: 'paul.martin@exemple.fr' })).status).toBe(403);
    expect(db.annuaire_responsables).toHaveLength(0);
  });
});

describe('Se retirer et anonymisation', () => {
  it('un responsable se retire lui-même', async () => {
    db.annuaire_responsables.push({ id: 'r1', commune_id: 'c1', fiche_id: 'f-asso', user_id: 'u-pres', statut: 'actif' });
    expect((await appel('/f-asso/responsables/quitter', 'POST', 'u-pres', 'citoyen')).status).toBe(200);
    expect(db.annuaire_responsables).toHaveLength(0);
  });
  it('un habitant ne peut pas retirer un autre responsable', async () => {
    db.annuaire_responsables.push({ id: 'r1', commune_id: 'c1', fiche_id: 'f-asso', user_id: 'u-pres', statut: 'actif' });
    expect((await appel('/f-asso/responsables/r1', 'DELETE', 'u-autre', 'citoyen')).status).toBe(403);
    expect(db.annuaire_responsables).toHaveLength(1);
  });
  it('une association reprise par un autre responsable survit à l\'anonymisation de son créateur', async () => {
    db.annuaire.push({ id: 'f-creee', commune_id: 'c1', user_id: 'u-pres', nom: 'Club photo', categorie: 'association' });
    db.annuaire_responsables.push(
      { id: 'r1', commune_id: 'c1', fiche_id: 'f-creee', user_id: 'u-pres', statut: 'actif' },
      { id: 'r2', commune_id: 'c1', fiche_id: 'f-creee', user_id: 'u-autre', statut: 'actif' },
    );
    await detacherFichesAssociations(ENV, 'c1', ['u-pres']);
    expect(db.annuaire.find((f) => f.id === 'f-creee')!.user_id).toBeNull();
    expect(db.annuaire_responsables.map((r) => r.id)).toEqual(['r2']);
  });
  it('le créateur ne peut plus supprimer une fiche reprise par un autre responsable', async () => {
    db.annuaire.push({ id: 'f-creee', commune_id: 'c1', user_id: 'u-pres', nom: 'Club photo', categorie: 'association' });
    db.annuaire_responsables.push({ id: 'r2', commune_id: 'c1', fiche_id: 'f-creee', user_id: 'u-autre', statut: 'actif' });
    expect((await appel('/f-creee', 'DELETE', 'u-pres', 'citoyen')).status).toBe(403);
    expect((await appel('/f-creee', 'DELETE', 'u-maire', 'maire')).status).toBe(200);
  });
});

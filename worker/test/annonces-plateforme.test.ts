// worker/test/annonces-plateforme.test.ts
// Annonces de la plateforme : ciblage (toutes / communes / régions), destinataires, une seule à
// la fois par priorité, jamais une annonce déjà lue, pas d'invitation à noter pour qui a déjà noté.
// Côté backoffice : publication validée et refusée sans session staff.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import annoncesApp from '../src/routes/annonces_plateforme';
import annoncesBackoffice from '../src/backoffice/annonces-plateforme';
import { regionDuDepartement } from '../src/lib/regions';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return valeur !== null && valeur !== undefined && String(valeur) !== filtre.slice(4);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre.startsWith('lte.')) return new Date(valeur).getTime() <= new Date(filtre.slice(4)).getTime();
  if (filtre.startsWith('gt.')) return new Date(valeur).getTime() > new Date(filtre.slice(3)).getTime();
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre === 'not.is.true') return valeur !== true;
  return true;
}
const filtrer = (t: Ligne[], p: URLSearchParams) =>
  t.filter((l) => [...p.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || correspond(l[k], v)));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') return Promise.resolve(new Response(JSON.stringify(filtrer(db[table] || [], url.searchParams)), { status: 200 }));
  if (methode === 'POST') {
    const l = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...JSON.parse(String(init.body)) };
    if (table === 'annonces_plateforme_lues' && db[table].some((x) => x.annonce_id === l.annonce_id && x.user_id === l.user_id)) {
      return Promise.resolve(new Response(JSON.stringify({ code: '23505', message: 'duplicate key' }), { status: 409 }));
    }
    (db[table] ??= []).push(l);
    return Promise.resolve(new Response(JSON.stringify([l]), { status: 201 }));
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dans = (jours: number) => new Date(Date.now() + jours * 86400000).toISOString();
const annonce = (n: number, extra: Ligne) => ({
  id: UUID(n), type: 'info', texte: `Annonce ${n}`, action: 'aucune', cible: 'toutes', communes_ids: [], regions: [],
  destinataires: 'tous', debut_le: dans(-1), fin_le: dans(5), created_at: dans(-1), ...extra,
});
const lire = async (commune_id: string, role = 'citoyen', user_id = 'u1') => {
  const token = await sign({ user_id, commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET);
  const res = await annoncesApp.request('/', { headers: { Cookie: `agora_access=${token}` } }, ENV);
  return ((await res.json()) as any).annonce;
};

beforeEach(() => {
  db = {
    annonces_plateforme: [], annonces_plateforme_lues: [], avis_application: [], users: [],
    communes: [{ id: 'somme', nom: 'Huppy', departement: '80' }, { id: 'landes', nom: 'Garein', departement: null }],
    prospects: [{ commune_id: 'landes', departement: '40' }],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('régions', () => {
  it('déduit la région du département, y compris un code à un chiffre', () => {
    expect(regionDuDepartement('80')).toBe('Hauts-de-France');
    expect(regionDuDepartement('2')).toBe('Hauts-de-France');
    expect(regionDuDepartement('2A')).toBe('Corse');
    expect(regionDuDepartement(null)).toBeNull();
  });
});

describe('GET /annonces-plateforme (application)', () => {
  it('ne renvoie rien quand aucune annonce n\'est en cours', async () => {
    db.annonces_plateforme.push(annonce(1, { fin_le: dans(-1) }), annonce(2, { debut_le: dans(1) }));
    expect(await lire('somme')).toBeNull();
  });

  it('cible une commune précise ou une région (département de la fiche prospect à défaut)', async () => {
    db.annonces_plateforme.push(
      annonce(1, { cible: 'communes', communes_ids: ['somme'], texte: 'Pour Huppy' }),
      annonce(2, { cible: 'regions', regions: ['Nouvelle-Aquitaine'], texte: 'Pour les Landes' }),
    );
    expect((await lire('somme')).texte).toBe('Pour Huppy');
    expect((await lire('landes')).texte).toBe('Pour les Landes');
  });

  it('réserve une annonce « mairies » aux gestionnaires', async () => {
    db.annonces_plateforme.push(annonce(1, { destinataires: 'gestionnaires' }));
    expect(await lire('somme', 'citoyen')).toBeNull();
    expect((await lire('somme', 'admin')).id).toBe(UUID(1));
  });

  it("n'en renvoie qu'une, la plus importante, et jamais une déjà lue", async () => {
    db.annonces_plateforme.push(annonce(1, { type: 'astuce' }), annonce(2, { type: 'maintenance' }), annonce(3, { type: 'nouveaute' }));
    expect((await lire('somme')).type).toBe('maintenance');
    db.annonces_plateforme_lues.push({ annonce_id: UUID(2), user_id: 'u1', commune_id: 'somme' });
    expect((await lire('somme')).type).toBe('nouveaute');
    expect((await lire('somme', 'citoyen', 'u2')).type).toBe('maintenance');
  });

  it("n'invite pas à noter l'application quelqu'un qui l'a déjà notée", async () => {
    db.annonces_plateforme.push(annonce(1, { type: 'astuce', action: 'avis' }));
    expect((await lire('somme')).action).toBe('avis');
    db.avis_application.push({ id: 'a1', commune_id: 'somme', user_id: 'u1' });
    expect(await lire('somme')).toBeNull();
  });
});

describe('POST /annonces-plateforme/:id/lu', () => {
  it('marque comme lue, sans erreur si on recommence', async () => {
    const token = await sign({ user_id: 'u1', commune_id: 'somme', role: 'citoyen', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET);
    const marquer = () => annoncesApp.request(`/${UUID(7)}/lu`, { method: 'POST', headers: { Cookie: `agora_access=${token}` } }, ENV);
    expect((await marquer()).status).toBe(200);
    expect((await marquer()).status).toBe(200);
    expect(db.annonces_plateforme_lues).toHaveLength(1);
  });
});

describe('POST /annonces-plateforme (backoffice)', () => {
  const publier = async (corps: object, avecSession = true) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (avecSession) headers.Cookie = `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`;
    return annoncesBackoffice.request('/', { method: 'POST', headers, body: JSON.stringify(corps) }, ENV);
  };
  const base = { type: 'astuce', texte: 'Le saviez-vous ?', cible: 'toutes', fin_le: dans(14) };

  it('refuse sans session staff', async () => {
    expect((await publier(base, false)).status).toBe(401);
  });
  it('publie une annonce valide', async () => {
    expect((await publier({ ...base, action: 'partager' })).status).toBe(201);
    expect(db.annonces_plateforme[0]).toMatchObject({ type: 'astuce', action: 'partager', cree_par: 's1' });
  });
  it('exige au moins une commune ou une région selon la cible, et une durée raisonnable', async () => {
    expect((await publier({ ...base, cible: 'communes' })).status).toBe(400);
    expect((await publier({ ...base, cible: 'regions', regions: ['Atlantide'] })).status).toBe(400);
    expect((await publier({ ...base, fin_le: dans(200) })).status).toBe(400);
    expect(db.annonces_plateforme).toHaveLength(0);
  });
});

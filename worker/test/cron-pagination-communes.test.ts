// worker/test/cron-pagination-communes.test.ts
// Couvre le bug trouvé le 2026-10-16 : plusieurs routines du cron listaient TOUTES les
// communes via supabaseSelect (pas supabaseSelectTout), qui ne renvoie que les 1000 premières
// lignes (plafond PostgREST, silencieux) — la table communes en a 14 000+ en production
// (prospects auto-activés sans inscription complète, voir activerCommuneGratuite). Résultat :
// purgerMur ne purgeait qu'une tranche arbitraire de communes chaque nuit, jamais garanti de
// couvrir une commune réelle donnée (signalement initial : le Mur des voisins ne se vidait
// jamais sur une commune précise). Ce test simule explicitement >1000 communes avec une
// pagination fidèle (limit/offset respectés par le faux fetch, contrairement aux autres tests
// de ce projet qui les ignorent) pour prouver que purgerMur couvre bien la 1001e commune.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { purgerMur } from '../src/cron';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
};

function reinitialiser() {
  db = { communes: [], posts: [] };
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('lt.')) return new Date(valeur).getTime() < new Date(filtre.slice(3)).getTime();
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  return true;
}

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';

  if (methode === 'GET') {
    let lignes = (db[table] || []).filter((l) =>
      [...url.searchParams.entries()].every(([cle, valeur]) =>
        ['select', 'order', 'limit', 'offset'].includes(cle) || correspond(l[cle], valeur)));
    // Pagination fidèle (contrairement aux autres mocks de ce projet) : c'est précisément ce
    // comportement — le plafond de 1000 lignes par défaut de PostgREST — que ce test vérifie.
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 1000;
    const offset = Number(url.searchParams.get('offset') || '0');
    lignes = lignes.slice(offset, offset + limit);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'DELETE') {
    const avant = (db[table] || []).length;
    db[table] = (db[table] || []).filter((l) =>
      ![...url.searchParams.entries()].every(([cle, valeur]) => correspond(l[cle], valeur)));
    return Promise.resolve(new Response(JSON.stringify({ supprimees: avant - db[table].length }), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

beforeEach(() => {
  reinitialiser();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('purgerMur — pagination au-delà de 1000 communes', () => {
  it('purge bien une commune au-delà de la 1000e (pas seulement les 1000 premières)', async () => {
    // Timeout relevé : 1005 communes traitées séquentiellement (select + delete chacune) via
    // le faux fetch prend plus que les 5s par défaut une fois la suite complète en cours
    // (concurrence avec les 24 autres fichiers de test).
    const ancien = new Date(Date.now() - 72 * 3600 * 1000).toISOString(); // > 48h, purgeable
    for (let i = 0; i < 1005; i++) {
      const communeId = 'c' + i;
      db.communes.push({ id: communeId, mur_duree: '48h' });
      db.posts.push({ id: 'p' + i, commune_id: communeId, created_at: ancien });
    }

    await purgerMur(ENV);

    // La 1001e-1005e commune (au-delà du plafond PostgREST de 1000) doit aussi être purgée.
    expect(db.posts.find((p) => p.commune_id === 'c1004')).toBeUndefined();
    expect(db.posts).toHaveLength(0);
  }, 20000);

  it('ne fait pas une requête par commune et respecte la durée propre à chaque commune', async () => {
    for (let i = 0; i < 3000; i++) db.communes.push({ id: 'vide' + i, mur_duree: '24h' });
    const il30h = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    db.communes.push({ id: 'c48', mur_duree: '48h' }, { id: 'c24', mur_duree: '24h' });
    db.posts.push({ id: 'garde', commune_id: 'c48', created_at: il30h }, { id: 'purge', commune_id: 'c24', created_at: il30h });

    let requetes = 0;
    vi.stubGlobal('fetch', (input: any, init?: any) => { requetes++; return fetchFake(input, init); });
    await purgerMur(ENV);

    expect(db.posts.map((p) => p.id)).toEqual(['garde']);
    expect(requetes).toBeLessThan(10);
  });
});

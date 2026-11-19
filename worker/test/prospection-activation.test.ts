// worker/test/prospection-activation.test.ts
// Espace gratuit créé par la prospection (2026-11-19) : la commune doit recevoir le département
// de sa fiche prospect, sinon la synchro Météo-France l'ignore (aucune vigilance, aucune
// notification) — 13 937 espaces créés ainsi d'août à octobre 2026, rattrapés le 2026-11-19.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { activerCommuneGratuite } from '../src/backoffice/prospection';
import { completerLocalisationCommune } from '../src/lib/localisation-commune';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k' };

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  const ok = (corps: any, status = 200) => Promise.resolve(new Response(JSON.stringify(corps), { status }));
  const garde = (l: Ligne) => {
    for (const [cle, v] of url.searchParams.entries()) {
      if (v.startsWith('eq.') && String(l[cle]) !== v.slice(3)) return false;
      if (v === 'is.null' && l[cle] != null) return false;
      if (v === 'not.is.null' && l[cle] == null) return false;
    }
    return true;
  };
  if (methode === 'GET') return ok((db[table] || []).filter(garde));
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const lignes = (Array.isArray(corps) ? corps : [corps]).map((l: Ligne) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...lignes);
    return ok(lignes, 201);
  }
  if (methode === 'PATCH') {
    const lignes = (db[table] || []).filter(garde);
    for (const l of lignes) Object.assign(l, JSON.parse(String(init.body)));
    return ok(lignes);
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

beforeEach(() => {
  db = { communes: [], users: [], onglets_gratuits: [{ cle: 'actualites' }], onglets_config: [], prospects: [] };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('activation gratuite depuis la prospection', () => {
  it('la commune créée reçoit le département et les coordonnées du prospect', async () => {
    await activerCommuneGratuite(ENV, {
      id: 'p-1', nom: 'Motteville', population: 380, lat: 49.63, lng: 0.85, departement: '76',
      contact_email: 'mairie@exemple.fr', commune_id: null,
    });
    expect(db.communes).toHaveLength(1);
    expect(db.communes[0]).toMatchObject({ nom: 'Motteville', departement: '76', lat: 49.63, lng: 0.85, forfait: 'Gratuit' });
  });
});

describe('rattrapage au premier vrai usage (inscription, connexion, lien)', () => {
  it('un espace sans département le reçoit de sa fiche prospect, avec les coordonnées', async () => {
    db.communes = [{ id: 'c-1', departement: null, lat: null, lng: null }];
    db.prospects = [{ id: 'p-1', commune_id: 'c-1', departement: '40', lat: 44.0, lng: -0.44 }];
    await completerLocalisationCommune(ENV, 'c-1');
    expect(db.communes[0]).toMatchObject({ departement: '40', lat: 44.0, lng: -0.44 });
  });

  it('jamais d’écrasement : une commune qui a déjà son département n’est pas touchée', async () => {
    db.communes = [{ id: 'c-1', departement: '80', lat: 50.1, lng: 1.9 }];
    db.prospects = [{ id: 'p-1', commune_id: 'c-1', departement: '40', lat: 44.0, lng: -0.44 }];
    await completerLocalisationCommune(ENV, 'c-1');
    expect(db.communes[0]).toMatchObject({ departement: '80', lat: 50.1, lng: 1.9 });
  });

  it('sans fiche prospect : rien ne change, rien ne casse', async () => {
    db.communes = [{ id: 'c-1', departement: null, lat: null, lng: null }];
    await expect(completerLocalisationCommune(ENV, 'c-1')).resolves.toBeUndefined();
    expect(db.communes[0].departement).toBeNull();
  });
});

// worker/test/coups-de-main-ameliorations.test.ts
// Couvre les 3 ameliorations du 2026-10-13 : statut "pourvu", photo optionnelle (retrait via
// PATCH null), et l'interet prive (POST /:id/interet + GET /:id/interets reserve a l'auteur).
// Meme esprit de faux fetch() que test/lois.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import coupsDeMain from '../src/routes/coups_de_main';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  JWT_SECRET,
  R2_PUBLIC_BASE: 'https://cdn.exemple.test',
};

function reinitialiser() {
  db = { coups_de_main: [], coups_de_main_interets: [], coups_de_main_reactions: [], users: [] };
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  return true;
}
function appliquerRequete(table: Ligne[], params: URLSearchParams): Ligne[] {
  let lignes = [...table];
  for (const [cle, valeur] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  return lignes;
}
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname === 'onesignal-nope.invalid') return Promise.reject(new Error('jamais appelé'));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') {
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const inserees = (Array.isArray(corps) ? corps : [corps]).map((l: Ligne) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...inserees);
    return Promise.resolve(new Response(JSON.stringify(inserees), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init.body));
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, corps);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'DELETE') {
    const avant = (db[table] || []).length;
    db[table] = (db[table] || []).filter((l) => !correspond(l.id, url.searchParams.get('id') || ''));
    return Promise.resolve(new Response(JSON.stringify({ supprimees: avant - db[table].length }), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

async function cookiePour(commune_id: string, user_id: string, role = 'citoyen') {
  const token = await sign({ user_id, commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET);
  return { headers: { Cookie: `agora_access=${token}` } };
}

// POST /:id/interet notifie l'auteur via c.executionCtx.waitUntil — absent par défaut quand on
// appelle .request() directement dans un test (Hono lève sinon "This context has no
// ExecutionContext"), d'où ce faux contexte minimal.
const FAUX_EXECUTION_CTX = { waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {} };

// envoyerNotificationAUtilisateurs lit push_subscriptions (vide ici = aucun envoi, sans erreur).
beforeEach(() => {
  reinitialiser();
  db.push_subscriptions = [] as any;
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /:id/interet', () => {
  it('refuse d\'exprimer un intérêt pour sa propre annonce', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', titre: 'Prêt tondeuse' });
    const res = await coupsDeMain.request('/a1/interet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'auteur')), body: JSON.stringify({}),
    }, ENV, FAUX_EXECUTION_CTX);
    expect(res.status).toBe(400);
  });

  it('enregistre un intérêt avec message, puis refuse un doublon', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', titre: 'Prêt tondeuse' });
    const res1 = await coupsDeMain.request('/a1/interet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'voisin')), body: JSON.stringify({ message: 'Dispo ce week-end, 06...' }),
    }, ENV, FAUX_EXECUTION_CTX);
    expect(res1.status).toBe(201);
    expect(db.coups_de_main_interets).toHaveLength(1);
    expect(db.coups_de_main_interets[0].message).toContain('06');

    const res2 = await coupsDeMain.request('/a1/interet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'voisin')), body: JSON.stringify({}),
    }, ENV, FAUX_EXECUTION_CTX);
    expect(res2.status).toBe(400);
    expect(db.coups_de_main_interets).toHaveLength(1);
  });
});

describe('GET /:id/interets', () => {
  it('réservé à l\'auteur — un autre citoyen est refusé', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur' });
    const res = await coupsDeMain.request('/a1/interets', { ...(await cookiePour('c1', 'curieux')) }, ENV);
    expect(res.status).toBe(403);
  });

  it('l\'auteur voit les intéressés avec leur identité', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur' });
    db.users.push({ id: 'voisin', commune_id: 'c1', prenom: 'Jean', nom: 'Dupont' });
    db.coups_de_main_interets.push({ id: 'i1', commune_id: 'c1', annonce_id: 'a1', user_id: 'voisin', message: 'Dispo' });
    const res = await coupsDeMain.request('/a1/interets', { ...(await cookiePour('c1', 'auteur')) }, ENV);
    expect(res.status).toBe(200);
    const { interets } = await res.json();
    expect(interets).toHaveLength(1);
    expect(interets[0].prenom).toBe('Jean');
  });
});

describe('PATCH /:id — pourvu et photo', () => {
  it('marque une annonce comme pourvue', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', pourvu: false });
    const res = await coupsDeMain.request('/a1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'auteur')), body: JSON.stringify({ pourvu: true }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.coups_de_main[0].pourvu).toBe(true);
  });

  it('retire une photo déjà jointe (null explicite)', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', photo_r2_key: 'c1/coups-de-main/x.jpg', photo_url: 'https://cdn.exemple.test/c1/coups-de-main/x.jpg' });
    const res = await coupsDeMain.request('/a1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'auteur')), body: JSON.stringify({ photo_r2_key: null }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.coups_de_main[0].photo_url).toBeNull();
  });
});

// Réactions emoji « façon Discord » (2026-11-22, migration 116) : palette fixe, bascule
// ajout/retrait, plusieurs emojis par personne, jamais l'annonce d'une autre commune.
describe('POST /:id/reactions', () => {
  async function reagir(emoji: string, user = 'voisin', commune = 'c1') {
    return coupsDeMain.request('/a1/reactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour(commune, user)), body: JSON.stringify({ emoji }),
    }, ENV);
  }

  it('refuse un emoji hors palette', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur' });
    const res = await reagir('🖕');
    expect(res.status).toBe(400);
    expect(db.coups_de_main_reactions).toHaveLength(0);
  });

  it('ajoute puis retire la même réaction (bascule), plusieurs emojis possibles', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur' });
    await reagir('👍');
    const res = await reagir('❤️');
    expect(res.status).toBe(200);
    expect(db.coups_de_main_reactions).toHaveLength(2);
    const { reactions } = await res.json();
    expect(reactions).toEqual(expect.arrayContaining([{ emoji: '👍', total: 1, moi: true }]));

    const res2 = await reagir('👍');
    expect((await res2.json()).reactions).toEqual([{ emoji: '❤️', total: 1, moi: true }]);
    expect(db.coups_de_main_reactions).toHaveLength(1);
  });

  it('refuse de réagir à une annonce d\'une autre commune', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur' });
    const res = await reagir('👍', 'intrus', 'c2');
    expect(res.status).toBe(404);
    expect(db.coups_de_main_reactions).toHaveLength(0);
  });

  it('GET / renvoie les réactions regroupées et la palette', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', description: 'x' });
    db.coups_de_main_reactions.push(
      { id: 'r1', commune_id: 'c1', annonce_id: 'a1', user_id: 'voisin', emoji: '🎉' },
      { id: 'r2', commune_id: 'c1', annonce_id: 'a1', user_id: 'autre', emoji: '🎉' },
      { id: 'r3', commune_id: 'c1', annonce_id: 'a1', user_id: 'autre', emoji: '👍' },
    );
    const res = await coupsDeMain.request('/', { ...(await cookiePour('c1', 'voisin')) }, ENV);
    const data = await res.json();
    expect(data.palette_reactions).toContain('👍');
    expect(data.annonces[0].reactions).toEqual([
      { emoji: '🎉', total: 2, moi: true },
      { emoji: '👍', total: 1, moi: false },
    ]);
  });
});

// Modifier / retirer son intérêt (2026-11-22) : uniquement le sien, jamais celui d'un autre.
describe('PATCH et DELETE /:id/interet', () => {
  function semer() {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', description: 'x' });
    db.coups_de_main_interets.push({ id: 'i1', commune_id: 'c1', annonce_id: 'a1', user_id: 'voisin', message: 'Dispo samedi' });
  }

  it('modifie le message de son intérêt', async () => {
    semer();
    const res = await coupsDeMain.request('/a1/interet', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'voisin')), body: JSON.stringify({ message: 'Plutôt dimanche' }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.coups_de_main_interets[0].message).toBe('Plutôt dimanche');
  });

  it('un autre citoyen ne peut ni modifier ni retirer un intérêt qui n\'est pas le sien', async () => {
    semer();
    const res = await coupsDeMain.request('/a1/interet', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'curieux')), body: JSON.stringify({ message: 'piraté' }),
    }, ENV);
    expect(res.status).toBe(404);
    const res2 = await coupsDeMain.request('/a1/interet', { method: 'DELETE', ...(await cookiePour('c1', 'curieux')) }, ENV);
    expect(res2.status).toBe(404);
    expect(db.coups_de_main_interets).toHaveLength(1);
    expect(db.coups_de_main_interets[0].message).toBe('Dispo samedi');
  });

  it('retire son intérêt, et GET / indique mon_interet', async () => {
    semer();
    const avant = await (await coupsDeMain.request('/', { ...(await cookiePour('c1', 'voisin')) }, ENV)).json();
    expect(avant.annonces[0].mon_interet).toEqual({ message: 'Dispo samedi' });

    const res = await coupsDeMain.request('/a1/interet', { method: 'DELETE', ...(await cookiePour('c1', 'voisin')) }, ENV);
    expect(res.status).toBe(200);
    expect(db.coups_de_main_interets).toHaveLength(0);

    const apres = await (await coupsDeMain.request('/', { ...(await cookiePour('c1', 'voisin')) }, ENV)).json();
    expect(apres.annonces[0].mon_interet).toBeNull();
  });
});

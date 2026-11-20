// worker/test/double-authentification.test.ts
// Double authentification des comptes de la mairie (migration 111, lib/double-authentification.ts) :
// code par email seulement sur un appareil inconnu, appareil reconnu 6 mois ensuite, jamais pour
// un habitant, 5 essais, usage unique, 3 envois, cloisonnement par commune, refus si l'email ne part pas.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import auth from '../src/auth';
import { hasherMotDePasse } from '../src/lib/password';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let emails: any[];
let HASH: string;
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'secret-de-test-suffisamment-long', RESEND_API_KEY: 'k', FRONTEND_URL: 'https://site.test' };
const CTX: any = { waitUntil() {}, passThroughOnException() {} };
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

function correspond(v: any, f: string): boolean {
  if (f.startsWith('eq.')) return String(v) === f.slice(3);
  if (f.startsWith('ilike.')) return String(v ?? '').toLowerCase() === f.slice(6).toLowerCase();
  if (f === 'is.null') return v == null;
  if (f.startsWith('neq.')) return String(v) !== f.slice(4);
  if (f.startsWith('lt.')) return v != null && String(v) < f.slice(3);
  if (f.startsWith('gte.')) return v != null && String(v) >= f.slice(4);
  return true;
}
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin === 'https://api.resend.com') {
    emails.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response('{"id":"r"}', { status: 200 }));
  }
  const table = url.pathname.replace('/rest/v1/', '');
  const lignes = (db[table] ||= []).filter((l) => [...url.searchParams.entries()]
    .every(([k, v]) => ['select', 'order', 'limit', 'offset', 'on_conflict', 'or', 'and'].includes(k) || correspond(l[k], v)));
  const methode = init?.method || 'GET';
  if (methode === 'GET' || methode === 'HEAD') return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  if (methode === 'PATCH') {
    for (const l of lignes) Object.assign(l, JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'DELETE') {
    db[table] = db[table].filter((l) => !lignes.includes(l));
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  const ajoutes = [JSON.parse(String(init.body))].flat().map((l) => ({ id: `${table}-${db[table].length + 1}`, created_at: new Date().toISOString(), ...l }));
  db[table].push(...ajoutes);
  return Promise.resolve(new Response(JSON.stringify(ajoutes), { status: 201 }));
}

// La route /login lit la commune résolue par le middleware tenant : on la simule. Le client garde
// les cookies reçus d'une requête à l'autre, comme un navigateur.
function client(commune_id = C1) {
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('commune_id_resolue' as any, commune_id); await next(); });
  app.route('/', auth);
  const cookies: Record<string, string> = {};
  return {
    cookies,
    async post(chemin: string, corps: object, env = ENV) {
      const res = await app.request(chemin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
        body: JSON.stringify(corps),
      }, { ...env }, CTX);
      for (const brut of res.headers.getSetCookie?.() ?? []) {
        const [paire] = brut.split(';');
        const [k, ...v] = paire.split('=');
        cookies[k.trim()] = v.join('=');
      }
      return { res, data: await res.json() as any };
    },
  };
}
const codeRecu = () => String(emails.at(-1)?.subject).match(/(\d{6})/)?.[1] as string;
const loginMaire = (cl: ReturnType<typeof client>) => cl.post('/login', { email: 'maire@c1.fr', password: 'secret123' });

beforeAll(async () => { HASH = await hasherMotDePasse('secret123'); });
beforeEach(() => {
  db = {
    users: [
      { id: 'maire1', commune_id: C1, role: 'maire', email: 'maire@c1.fr', prenom: 'Marie', password_hash: HASH, bloque_le: null, compte_supprime_le: null },
      { id: 'hab1', commune_id: C1, role: 'citoyen', email: 'hab@c1.fr', prenom: 'Paul', password_hash: HASH, bloque_le: null, compte_supprime_le: null },
    ],
    codes_connexion: [], appareils_confiance: [], refresh_tokens: [], tentatives_connexion: [],
  };
  emails = [];
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Connexion par mot de passe', () => {
  it('un habitant entre directement, sans code', async () => {
    const cl = client();
    const { res, data } = await cl.post('/login', { email: 'hab@c1.fr', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(cl.cookies.agora_access).toBeTruthy();
    expect(emails).toHaveLength(0);
  });

  it('un compte de la mairie sur un appareil inconnu : pas de session, un code par email', async () => {
    const cl = client();
    const { res, data } = await loginMaire(cl);
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ double_authentification: true });
    expect(data.email_masque).toMatch(/^m•+@c1\.fr$/);
    expect(cl.cookies.agora_access).toBeUndefined();
    expect(codeRecu()).toMatch(/^\d{6}$/);
    expect(db.codes_connexion[0].code_hash).not.toContain(codeRecu());
  });

  it('mauvais mot de passe : jamais de code envoyé', async () => {
    const { res } = await client().post('/login', { email: 'maire@c1.fr', password: 'faux' });
    expect(res.status).toBe(401);
    expect(emails).toHaveLength(0);
  });

  it('email impossible à envoyer : connexion refusée, jamais ouverte sans code', async () => {
    const cl = client();
    const { res } = await cl.post('/login', { email: 'maire@c1.fr', password: 'secret123' }, { ...ENV, RESEND_API_KEY: undefined });
    expect(res.status).toBe(503);
    expect(cl.cookies.agora_access).toBeUndefined();
  });
});

describe('Code et appareil reconnu', () => {
  it('le bon code ouvre la session et l\'appareil n\'a plus besoin de code ensuite', async () => {
    const cl = client();
    const { data } = await loginMaire(cl);
    const { res } = await cl.post('/login/code', { jeton: data.jeton, code: codeRecu() });
    expect(res.status).toBe(200);
    expect(cl.cookies.agora_access).toBeTruthy();
    expect(Object.keys(cl.cookies).some((k) => k.startsWith('agora_ap_'))).toBe(true);
    expect(db.appareils_confiance).toHaveLength(1);

    delete cl.cookies.agora_access;
    const second = await loginMaire(cl);
    expect(second.data.ok).toBe(true);
    expect(second.data.double_authentification).toBeUndefined();
    expect(emails).toHaveLength(1);
  });

  it('un autre appareil redemande un code', async () => {
    const cl = client();
    const { data } = await loginMaire(cl);
    await cl.post('/login/code', { jeton: data.jeton, code: codeRecu() });
    const autre = await loginMaire(client());
    expect(autre.data.double_authentification).toBe(true);
  });

  it('mauvais code : essais comptés, bloqué au 5e, même le bon code est alors refusé', async () => {
    const cl = client();
    const { data } = await loginMaire(cl);
    const bon = codeRecu();
    const faux = bon === '000000' ? '111111' : '000000';
    const premier = await cl.post('/login/code', { jeton: data.jeton, code: faux });
    expect(premier.res.status).toBe(401);
    expect(premier.data.erreur).toContain('4 essais restants');
    for (let i = 0; i < 3; i++) await cl.post('/login/code', { jeton: data.jeton, code: faux });
    expect((await cl.post('/login/code', { jeton: data.jeton, code: faux })).res.status).toBe(429);
    expect((await cl.post('/login/code', { jeton: data.jeton, code: bon })).res.status).toBe(410);
    expect(cl.cookies.agora_access).toBeUndefined();
  });

  it('code à usage unique', async () => {
    const cl = client();
    const { data } = await loginMaire(cl);
    const code = codeRecu();
    await cl.post('/login/code', { jeton: data.jeton, code });
    expect((await client().post('/login/code', { jeton: data.jeton, code })).res.status).toBe(410);
  });

  it('code expiré refusé', async () => {
    const cl = client();
    const { data } = await loginMaire(cl);
    db.codes_connexion[0].expires_at = '2020-01-01T00:00:00.000Z';
    expect((await cl.post('/login/code', { jeton: data.jeton, code: codeRecu() })).res.status).toBe(410);
  });

  it('un jeton d\'une commune ne vaut rien dans une autre', async () => {
    const { data } = await loginMaire(client());
    expect((await client(C2).post('/login/code', { jeton: data.jeton, code: codeRecu() })).res.status).toBe(410);
  });

  it('renvoyer : nouveau code (l\'ancien ne marche plus), 3 envois au plus', async () => {
    const cl = client();
    const { data } = await loginMaire(cl);
    const ancien = codeRecu();
    expect((await cl.post('/login/renvoyer-code', { jeton: data.jeton })).res.status).toBe(200);
    const nouveau = codeRecu();
    expect(emails).toHaveLength(2);
    if (ancien !== nouveau) expect((await cl.post('/login/code', { jeton: data.jeton, code: ancien })).res.status).toBe(401);
    await cl.post('/login/renvoyer-code', { jeton: data.jeton });
    expect((await cl.post('/login/renvoyer-code', { jeton: data.jeton })).res.status).toBe(429);
  });

  it('compte bloqué entre-temps : pas de session même avec le bon code', async () => {
    const cl = client();
    const { data } = await loginMaire(cl);
    db.users[0].bloque_le = '2026-11-20T00:00:00.000Z';
    expect((await cl.post('/login/code', { jeton: data.jeton, code: codeRecu() })).res.status).toBe(403);
    expect(cl.cookies.agora_access).toBeUndefined();
  });
});

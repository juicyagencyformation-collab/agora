// worker/test/double-authentification-backoffice.test.ts
// Double authentification du backoffice « une fois par jour » (migration 112) : jamais de session
// sur le seul mot de passe, code valable jusqu'au lendemain 5 h (Paris), puis code du jour demandé
// sans mot de passe tant que la session de 30 jours tient ; anciennes sessions soumises au code.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { decode } from '@tsndr/cloudflare-worker-jwt';
import authBackoffice from '../src/backoffice/auth';
import { hasherMotDePasse } from '../src/lib/password';
import { finDuCodeDuJour } from '../src/lib/double-authentification';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let emails: any[];
let HASH: string;
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'secret-de-test-suffisamment-long', RESEND_API_KEY: 'k' };

function correspond(v: any, f: string): boolean {
  if (f.startsWith('eq.')) return String(v) === f.slice(3);
  if (f === 'is.null') return v == null;
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
    .every(([k, v]) => ['select', 'order', 'limit'].includes(k) || correspond(l[k], v)));
  const methode = init?.method || 'GET';
  if (methode === 'GET') return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  if (methode === 'PATCH') {
    for (const l of lignes) Object.assign(l, JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'DELETE') {
    db[table] = db[table].filter((l) => !lignes.includes(l));
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  const ajoutes = [JSON.parse(String(init.body))].flat().map((l) => ({ id: `${table}-${db[table].length + 1}`, revoked: false, created_at: new Date().toISOString(), ...l }));
  db[table].push(...ajoutes);
  return Promise.resolve(new Response(JSON.stringify(ajoutes), { status: 201 }));
}

function navigateur() {
  const cookies: Record<string, string> = {};
  return {
    cookies,
    async post(chemin: string, corps?: object) {
      const res = await authBackoffice.request(chemin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
        body: corps ? JSON.stringify(corps) : undefined,
      }, ENV);
      for (const brut of res.headers.getSetCookie?.() ?? []) {
        const [paire] = brut.split(';');
        const [k, ...v] = paire.split('=');
        if (/max-age=0/i.test(brut)) delete cookies[k.trim()];
        else cookies[k.trim()] = v.join('=');
      }
      return { res, data: await res.json() as any };
    },
  };
}
const codeRecu = () => String(emails.at(-1)?.subject).match(/(\d{6})/)?.[1] as string;
async function connexionComplete(nav = navigateur()) {
  const { data } = await nav.post('/login', { email: 'leandre@exemple.fr', password: 'secret123' });
  await nav.post('/login/code', { jeton: data.jeton, code: codeRecu() });
  return nav;
}

beforeAll(async () => { HASH = await hasherMotDePasse('secret123'); });
beforeEach(() => {
  db = {
    staff_backoffice: [{ id: 's1', email: 'leandre@exemple.fr', nom: 'Léandre', password_hash: HASH, actif: true }],
    staff_refresh_tokens: [], staff_codes_connexion: [], tentatives_connexion: [],
  };
  emails = [];
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Échéance du code du jour', () => {
  it('lendemain 5 h, heure de Paris, été comme hiver', () => {
    expect(finDuCodeDuJour(new Date('2026-11-20T10:00:00Z')).toISOString()).toBe('2026-11-21T04:00:00.000Z');
    expect(finDuCodeDuJour(new Date('2026-07-01T10:00:00Z')).toISOString()).toBe('2026-07-02T03:00:00.000Z');
    // 4 h 30 à Paris : le code du jour expire dans 30 minutes, pas demain
    expect(finDuCodeDuJour(new Date('2026-11-21T03:30:00Z')).toISOString()).toBe('2026-11-21T04:00:00.000Z');
  });
});

describe('Connexion au backoffice', () => {
  it('le mot de passe seul n\'ouvre jamais de session : un code part par email', async () => {
    const nav = navigateur();
    const { res, data } = await nav.post('/login', { email: 'leandre@exemple.fr', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(data.double_authentification).toBe(true);
    expect(nav.cookies.agora_bo).toBeUndefined();
    expect(codeRecu()).toMatch(/^\d{6}$/);
  });

  it('mauvais mot de passe : aucun code', async () => {
    const { res } = await navigateur().post('/login', { email: 'leandre@exemple.fr', password: 'faux' });
    expect(res.status).toBe(401);
    expect(emails).toHaveLength(0);
  });

  it('le bon code ouvre la session jusqu\'au lendemain 5 h, jeton d\'accès plafonné à cette échéance', async () => {
    const nav = await connexionComplete();
    expect(nav.cookies.agora_bo).toBeTruthy();
    const echeance = db.staff_refresh_tokens[0].mfa_valide_jusqu;
    expect(new Date(echeance).getTime()).toBe(finDuCodeDuJour().getTime());
    const exp = (decode(nav.cookies.agora_bo).payload as any).exp;
    expect(exp * 1000).toBeLessThanOrEqual(new Date(echeance).getTime());
  });

  it('dans la journée, le rafraîchissement ne redemande rien et garde l\'échéance', async () => {
    const nav = await connexionComplete();
    const { res } = await nav.post('/refresh');
    expect(res.status).toBe(200);
    expect(db.staff_refresh_tokens.at(-1)!.mfa_valide_jusqu).toBe(db.staff_refresh_tokens[0].mfa_valide_jusqu);
    expect(emails).toHaveLength(1);
  });

  it('le lendemain : code du jour demandé, sans mot de passe, et l\'ancienne session est remplacée', async () => {
    const nav = await connexionComplete();
    db.staff_refresh_tokens[0].mfa_valide_jusqu = '2020-01-01T04:00:00.000Z';
    const refresh = await nav.post('/refresh');
    expect(refresh.res.status).toBe(401);
    expect(refresh.data.code_requis).toBe(true);
    expect(db.staff_refresh_tokens[0].revoked).toBe(false);

    const demande = await nav.post('/demander-code');
    expect(demande.res.status).toBe(200);
    const code = await nav.post('/login/code', { jeton: demande.data.jeton, code: codeRecu() });
    expect(code.res.status).toBe(200);
    expect(db.staff_refresh_tokens[0].revoked).toBe(true);
    expect((await nav.post('/refresh')).res.status).toBe(200);
  });

  it('une session ouverte avant la double authentification doit passer le code', async () => {
    const nav = await connexionComplete();
    db.staff_refresh_tokens[0].mfa_valide_jusqu = null;
    expect((await nav.post('/refresh')).data.code_requis).toBe(true);
  });

  it('demander un code sans session : refusé, aucun email', async () => {
    const { res } = await navigateur().post('/demander-code');
    expect(res.status).toBe(401);
    expect(emails).toHaveLength(0);
  });

  it('compte désactivé entre-temps : pas de session même avec le bon code', async () => {
    const nav = navigateur();
    const { data } = await nav.post('/login', { email: 'leandre@exemple.fr', password: 'secret123' });
    db.staff_backoffice[0].actif = false;
    expect((await nav.post('/login/code', { jeton: data.jeton, code: codeRecu() })).res.status).toBe(401);
    expect(nav.cookies.agora_bo).toBeUndefined();
  });
});

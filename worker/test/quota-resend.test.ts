// worker/test/quota-resend.test.ts
// Suivi du quota Resend (migration 113) : relevé des en-têtes x-resend-daily-quota /
// x-resend-monthly-quota à l'envoi (au plus une écriture par minute, toujours en cas de refus pour
// quota), et lecture backoffice (relevé direct auprès de Resend, sinon dernier relevé, compteur du
// jour remis à zéro à minuit UTC).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import { envoyerEmail } from '../src/lib/email';
import quotaResend from '../src/backoffice/quota-resend';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let ecritures: number;
let reponseEnvoi: () => Response;
let reponseDomaines: () => Response;
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'k', JWT_SECRET: 'secret-de-test-suffisamment-long' };

const avecQuota = (jour: string | null, mois: string | null, statut = 200, corps = '{"id":"r"}') => {
  const h = new Headers();
  if (jour !== null) h.set('x-resend-daily-quota', jour);
  if (mois !== null) h.set('x-resend-monthly-quota', mois);
  return new Response(corps, { status: statut, headers: h });
};

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  if (url.href === 'https://api.resend.com/emails') return Promise.resolve(reponseEnvoi());
  if (url.href === 'https://api.resend.com/domains') return Promise.resolve(reponseDomaines());
  const table = url.pathname.replace('/rest/v1/', '');
  if ((init?.method || 'GET') === 'POST') {
    ecritures++;
    for (const l of [JSON.parse(String(init.body))].flat()) {
      const existant = (db[table] ||= []).find((x) => x.id === l.id);
      if (existant) Object.assign(existant, l); else db[table].push({ ...l });
    }
    return Promise.resolve(new Response('[]', { status: 201 }));
  }
  return Promise.resolve(new Response(JSON.stringify(db[table] || []), { status: 200 }));
}
const session = async () => ({ Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, ENV.JWT_SECRET)}` });

beforeEach(() => {
  db = { etat_resend: [] };
  ecritures = 0;
  reponseEnvoi = () => avecQuota('12', '340');
  reponseDomaines = () => avecQuota(null, null, 200, '{"data":[]}');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Relevé à l\'envoi', () => {
  it('note la consommation renvoyée par Resend, au plus une fois par minute', async () => {
    vi.setSystemTime(new Date('2026-11-20T10:05:00Z'));
    await envoyerEmail(ENV, 'a@b.fr', 'Sujet', '<p>x</p>');
    expect(db.etat_resend[0]).toMatchObject({ id: 1, quota_jour: 12, quota_mois: 340 });
    reponseEnvoi = () => avecQuota('13', '341');
    await envoyerEmail(ENV, 'a@b.fr', 'Sujet', '<p>x</p>');
    expect(db.etat_resend[0].quota_jour).toBe(12);
    vi.setSystemTime(new Date('2026-11-20T10:06:30Z'));
    await envoyerEmail(ENV, 'a@b.fr', 'Sujet', '<p>x</p>');
    expect(db.etat_resend[0].quota_jour).toBe(13);
    expect(ecritures).toBe(2);
  });

  it('un refus pour quota atteint est toujours noté', async () => {
    vi.setSystemTime(new Date('2026-11-20T11:00:00Z'));
    await envoyerEmail(ENV, 'a@b.fr', 'Sujet', '<p>x</p>');
    reponseEnvoi = () => avecQuota('100', '900', 429, '{"name":"daily_quota_exceeded","message":"quota"}');
    expect(await envoyerEmail(ENV, 'a@b.fr', 'Sujet', '<p>x</p>')).toBeNull();
    expect(db.etat_resend[0]).toMatchObject({ quota_jour: 100, dernier_refus: 'daily_quota_exceeded' });
  });

  it('sans en-tête de quota (plan payant), rien n\'est écrit', async () => {
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
    reponseEnvoi = () => new Response('{"id":"r"}', { status: 200 });
    await envoyerEmail(ENV, 'a@b.fr', 'Sujet', '<p>x</p>');
    expect(ecritures).toBe(0);
  });
});

describe('Lecture dans le backoffice', () => {
  it('réservée au staff', async () => {
    expect((await quotaResend.request('/', {}, ENV)).status).toBe(401);
  });

  it('relevé direct auprès de Resend quand il renvoie les en-têtes', async () => {
    reponseDomaines = () => avecQuota('42', '1200', 200, '{"data":[]}');
    const corps = await (await quotaResend.request('/', { headers: await session() }, ENV)).json() as any;
    expect(corps).toMatchObject({ jour: 42, mois: 1200, limite_jour: 100, limite_mois: 3000, direct: true, refus: null });
    expect(corps.remise_a_zero).toBe('2026-11-21T00:00:00.000Z');
  });

  it('sinon le dernier relevé, et le compteur du jour revient à 0 après minuit UTC', async () => {
    db.etat_resend.push({ id: 1, quota_jour: 87, quota_mois: 2100, maj_le: '2026-11-19T22:00:00.000Z',
      dernier_refus: 'daily_quota_exceeded', dernier_refus_le: '2026-11-19T21:00:00.000Z' });
    const corps = await (await quotaResend.request('/', { headers: await session() }, ENV)).json() as any;
    expect(corps).toMatchObject({ jour: 0, mois: 2100, direct: false, refus: null });
  });
});

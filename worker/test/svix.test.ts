// worker/test/svix.test.ts — vérification de signature des webhooks (Resend/Svix).
import { describe, it, expect } from 'vitest';
import { verifierSignatureSvix } from '../src/lib/svix';

const SECRET = 'whsec_' + btoa('0123456789abcdef0123456789abcdef');
const ID = 'msg_2abc';
const TS = '1700000000';
const BODY = JSON.stringify({ type: 'email.bounced', data: { to: ['x@y.fr'] } });

async function signer(secret: string, id: string, ts: string, body: string): Promise<string> {
  const octets = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (ch) => ch.charCodeAt(0));
  const cle = await crypto.subtle.importKey('raw', octets, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  let bin = '';
  for (const o of sig) bin += String.fromCharCode(o);
  return btoa(bin);
}

describe('verifierSignatureSvix', () => {
  it('accepte une signature valide (avec le préfixe v1,)', async () => {
    const sig = await signer(SECRET, ID, TS, BODY);
    expect(await verifierSignatureSvix(SECRET, ID, TS, `v1,${sig}`, BODY)).toBe(true);
  });

  it('accepte quand plusieurs signatures sont fournies', async () => {
    const sig = await signer(SECRET, ID, TS, BODY);
    expect(await verifierSignatureSvix(SECRET, ID, TS, `v1,mauvaise v1,${sig}`, BODY)).toBe(true);
  });

  it('rejette un corps altéré', async () => {
    const sig = await signer(SECRET, ID, TS, BODY);
    expect(await verifierSignatureSvix(SECRET, ID, TS, `v1,${sig}`, BODY + 'x')).toBe(false);
  });

  it('rejette un secret différent', async () => {
    const sig = await signer(SECRET, ID, TS, BODY);
    const autre = 'whsec_' + btoa('ffffffffffffffffffffffffffffffff');
    expect(await verifierSignatureSvix(autre, ID, TS, `v1,${sig}`, BODY)).toBe(false);
  });

  it('rejette si des en-têtes manquent', async () => {
    expect(await verifierSignatureSvix(SECRET, undefined, TS, 'v1,x', BODY)).toBe(false);
    expect(await verifierSignatureSvix('', ID, TS, 'v1,x', BODY)).toBe(false);
  });
});

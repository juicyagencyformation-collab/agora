// worker/test/documents-commune.test.ts
// Couvre le dossier documentaire (src/backoffice/documents-commune.ts) : les fichiers vont dans le
// bucket PRIVÉ (BUCKET_DOCUMENTS), formats et taille contrôlés, téléchargement jamais mis en cache,
// suppression réservée à l'admin, et jamais de fichier orphelin si la base échoue.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import documents from '../src/backoffice/documents-commune';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let bucket: Map<string, { data: ArrayBuffer; type?: string }>;
let echecInsertion = false;

const COMMUNE = '11111111-1111-4111-8111-111111111111';

function env(avecBucket = true): any {
  return {
    JWT_SECRET: 'secret-de-test', SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k',
    ...(avecBucket ? {
      BUCKET_DOCUMENTS: {
        put: async (cle: string, data: ArrayBuffer, o: any) => { bucket.set(cle, { data, type: o?.httpMetadata?.contentType }); },
        get: async (cle: string) => (bucket.has(cle) ? { body: bucket.get(cle)!.data } : null),
        delete: async (cle: string) => { bucket.delete(cle); },
      },
    } : {}),
  };
}

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  const filtres = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const garde = (l: Ligne) => filtres.every(([k, v]) => !v.startsWith('eq.') || String(l[k]) === v.slice(3));
  if (methode === 'GET') return Promise.resolve(new Response(JSON.stringify((db[table] || []).filter(garde))));
  if (methode === 'POST') {
    if (table === 'documents_commune' && echecInsertion) return Promise.resolve(new Response('boom', { status: 500 }));
    const lignes = [JSON.parse(init.body)].flat().map((l: Ligne) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...lignes);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 201 }));
  }
  if (methode === 'DELETE') { db[table] = (db[table] || []).filter((l) => !garde(l)); return Promise.resolve(new Response(null, { status: 204 })); }
  return Promise.reject(new Error('méthode non gérée ' + methode));
}

async function requete(chemin: string, init: RequestInit = {}, e = env()) {
  const jeton = await sign({ staff_id: 'staff-1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 600 }, 'secret-de-test');
  return documents.request(chemin, { ...init, headers: { ...(init.headers as any), Cookie: `agora_bo=${jeton}` } }, e);
}
function deposer(fichier: File, type = 'convention') {
  const fd = new FormData();
  fd.set('type', type); fd.set('signe_le', '2026-11-04'); fd.set('fichier', fichier);
  return requete(`/communes/${COMMUNE}`, { method: 'POST', body: fd });
}
const pdf = (taille = 10) => new File([new Uint8Array(taille)], 'convention-fay.pdf', { type: 'application/pdf' });

beforeEach(() => {
  db = { communes: [{ id: COMMUNE, nom: 'Fay' }], documents_commune: [], staff_backoffice: [{ id: 'staff-1', role: 'admin' }], journal_activite: [] };
  bucket = new Map(); echecInsertion = false;
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('dossier documentaire', () => {
  it('dépose un PDF dans le bucket privé et l’enregistre', async () => {
    const res = await deposer(pdf());
    expect(res.status).toBe(201);
    expect(bucket.size).toBe(1);
    const [cle] = [...bucket.keys()];
    expect(cle.startsWith(`${COMMUNE}/`)).toBe(true);
    expect(db.documents_commune[0]).toMatchObject({ type: 'convention', signe_le: '2026-11-04', r2_key: cle, depose_par: 'staff-1' });
  });

  it('refuse un format non autorisé ou un fichier trop lourd', async () => {
    expect((await deposer(new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }))).status).toBe(400);
    expect((await deposer(pdf(10 * 1024 * 1024 + 1))).status).toBe(400);
    expect(bucket.size).toBe(0);
  });

  it('télécharge en pièce jointe, sans jamais mettre en cache', async () => {
    await deposer(pdf(42));
    const res = await requete(`/${db.documents_commune[0].id}/fichier`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect((await res.arrayBuffer()).byteLength).toBe(42);
  });

  it('réserve la suppression au compte administrateur', async () => {
    await deposer(pdf());
    db.staff_backoffice[0].role = 'assistant';
    expect((await requete(`/${db.documents_commune[0].id}`, { method: 'DELETE' })).status).toBe(403);
    db.staff_backoffice[0].role = 'admin';
    expect((await requete(`/${db.documents_commune[0].id}`, { method: 'DELETE' })).status).toBe(200);
    expect(bucket.size).toBe(0);
    expect(db.documents_commune).toHaveLength(0);
  });

  it('ne laisse aucun fichier orphelin si la base refuse l’enregistrement', async () => {
    echecInsertion = true;
    await deposer(pdf()).catch(() => null);
    expect(bucket.size).toBe(0);
  });

  it('répond clairement tant que le bucket privé n’est pas configuré', async () => {
    const fd = new FormData(); fd.set('type', 'dpa'); fd.set('fichier', pdf());
    const res = await requete(`/communes/${COMMUNE}`, { method: 'POST', body: fd }, env(false));
    expect(res.status).toBe(503);
  });
});

describe('impression', () => {
  it('ouvre le document dans le navigateur avec ?affichage=1, toujours sans cache', async () => {
    db = { communes: [{ id: COMMUNE, nom: 'Fay' }], documents_commune: [], staff_backoffice: [{ id: 'staff-1', role: 'admin' }], journal_activite: [] };
    bucket = new Map();
    vi.stubGlobal('fetch', fetchFake);
    await deposer(pdf(7));
    const res = await requete(`/${db.documents_commune[0].id}/fichier?affichage=1`);
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline;/);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });
});

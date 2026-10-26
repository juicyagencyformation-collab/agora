// worker/test/export-commune.test.ts
// Restitution des données d'une commune : réservée au staff, limitée à la commune, sans aucun
// secret (le faux Supabase applique le select, comme le vrai : seule la liste de colonnes protège).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import exportCommune, { TABLES, NON_INCLUS } from '../src/backoffice/export-commune';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  if ((init?.method || 'GET') === 'POST') { (db[table] ??= []).push(JSON.parse(String(init.body))); return Promise.resolve(new Response('[]', { status: 201 })); }
  // select à plat ou avec tables embarquées « table(col,col) », reliées par commune_id comme en vrai
  const champs = (url.searchParams.get('select') || '').match(/\w+\([^)]*\)|\w+/g) || [];
  const projeter = (l: Ligne, cols: string[]) => Object.fromEntries(cols.filter((c) => c in l).map((c) => [c, l[c]]));
  const lignes = (db[table] || [])
    .filter((l) => [...url.searchParams.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || String(l[k]) === v.replace(/^eq\./, '')))
    .map((l) => Object.fromEntries(champs.flatMap((ch) => {
      const m = ch.match(/^(\w+)\(([^)]*)\)$/);
      if (!m) return ch in l ? [[ch, l[ch]]] : [];
      return [[m[1], (db[m[1]] || []).filter((e) => e.commune_id === l.id).map((e) => projeter(e, m[2].split(',')))]];
    })));
  return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
}
const session = async () => ({ Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}` });

beforeEach(() => {
  db = {
    communes: [{ id: 'fay', nom: 'Fay-les-Étangs', slug: 'faylesetangs', prix_annuel_ttc: 1, forfait: 'Fondateur' }],
    users: [
      { id: 'u1', commune_id: 'fay', nom: 'Dupont', prenom: 'Marie', email: 'm@fay.fr', role: 'maire', password_hash: 'SECRET', photo_profil_r2_key: 'cle' },
      { id: 'u2', commune_id: 'autre', nom: 'Autre', prenom: 'X', email: 'x@y.fr', role: 'citoyen', password_hash: 'SECRET2' },
    ],
    articles: [{ id: 'a1', commune_id: 'fay', titre: 'Bienvenue', contenu_html: '<p>Bonjour</p>' }],
    events: [{ id: 'e1', commune_id: 'fay', titre: 'Loto', qr_token: 'QR-SECRET' }],
    journal_activite: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /export-commune/:id', () => {
  it('refuse sans session staff', async () => {
    expect((await exportCommune.request('/fay', {}, ENV)).status).toBe(401);
  });

  it("restitue les données de la commune, et seulement d'elle, sans aucun secret", async () => {
    const res = await exportCommune.request('/fay', { headers: await session() }, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('donnees-faylesetangs-');
    const texte = await res.text();
    const d = JSON.parse(texte);
    expect(d.tables.users).toHaveLength(1);
    expect(d.tables.users[0]).toMatchObject({ prenom: 'Marie', email: 'm@fay.fr', role: 'maire' });
    expect(d.tables.articles[0].titre).toBe('Bienvenue');
    expect(d.nombre_lignes.events).toBe(1);
    expect(texte).not.toContain('SECRET');
    expect(texte).not.toContain('r2_key');
    expect(d.commune.prix_annuel_ttc).toBeUndefined();
    expect(Object.keys(d.non_inclus).length).toBeGreaterThan(0);
    expect(db.journal_activite[0]).toMatchObject({ action: 'export_donnees_commune' });
  });

  it("n'exporte jamais une colonne de secret ni de clé de stockage", () => {
    for (const [table, colonnes] of Object.entries(TABLES)) {
      expect(colonnes, table).not.toMatch(/password|token|r2_key|jeton|p256dh|endpoint|(^|,)auth(,|$)/);
    }
    expect(NON_INCLUS['secrets de sécurité']).toContain('password_reset_tokens');
  });
});

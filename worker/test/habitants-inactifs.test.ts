// worker/test/habitants-inactifs.test.ts
// Durée de conservation des comptes habitants (migration 110, lib/comptes-inactifs.ts) : 3 ans sans
// connexion → avertissement par email 30 jours avant → anonymisation, sauf reconnexion. Jamais les
// comptes de la mairie ni les communes de démonstration. Le faux Supabase interprète les filtres
// PostgREST utilisés (and/or imbriqués, lt/gt/is/not.is, jointure communes!inner).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { purgerHabitantsInactifs } from '../src/lib/comptes-inactifs';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let emails: any[];
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'k', FRONTEND_URL: 'https://site.test' };
const MAINTENANT = new Date('2030-06-01T03:00:00.000Z');

// Découpe « a,b(c,d),e » au premier niveau de parenthèses.
function decouper(s: string): string[] {
  const parts: string[] = []; let prof = 0; let cour = '';
  for (const ch of s) {
    if (ch === '(') prof++;
    if (ch === ')') prof--;
    if (ch === ',' && prof === 0) { parts.push(cour); cour = ''; } else cour += ch;
  }
  if (cour) parts.push(cour);
  return parts;
}
function valeurDe(l: Ligne, col: string): any {
  if (col.startsWith('communes.')) return db.communes.find((cm) => cm.id === l.commune_id)?.[col.slice(9)];
  return l[col];
}
function condition(l: Ligne, col: string, filtre: string): boolean {
  const v = valeurDe(l, col);
  if (filtre === 'is.null') return v == null;
  if (filtre === 'not.is.true') return v !== true;
  if (filtre.startsWith('eq.')) return String(v) === filtre.slice(3);
  if (filtre.startsWith('lt.')) return v != null && String(v) < filtre.slice(3);
  if (filtre.startsWith('gt.')) return v != null && String(v) > filtre.slice(3);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(v));
  throw new Error('filtre non géré : ' + filtre);
}
function expression(l: Ligne, expr: string): boolean {
  const m = expr.match(/^(and|or)\((.*)\)$/);
  if (m) {
    const res = decouper(m[2]).map((e) => expression(l, e));
    return m[1] === 'and' ? res.every(Boolean) : res.some(Boolean);
  }
  const [col, ...reste] = expr.split('.');
  return condition(l, col, reste.join('.'));
}
function filtrer(table: Ligne[], params: URLSearchParams): Ligne[] {
  return table.filter((l) => [...params.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
    if (k === 'and' || k === 'or') return expression(l, `${k}${v}`);
    return condition(l, k, v);
  }));
}
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin === 'https://api.resend.com') {
    emails.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response('{"id":"r"}', { status: 200 }));
  }
  const table = url.pathname.replace('/rest/v1/', '');
  const lignes = filtrer(db[table] ||= [], url.searchParams);
  const methode = init?.method || 'GET';
  if (methode === 'GET') {
    const limite = Number(url.searchParams.get('limit') || 1000);
    const avecCommune = lignes.map((l) => ({ ...l, communes: db.communes.find((cm) => cm.id === l.commune_id) }));
    return Promise.resolve(new Response(JSON.stringify(avecCommune.slice(0, limite)), { status: 200 }));
  }
  if (methode === 'PATCH') {
    for (const l of lignes) Object.assign(l, JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'DELETE') {
    db[table] = db[table].filter((l) => !lignes.includes(l));
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  return Promise.resolve(new Response('[]', { status: 201 }));
}

const habitant = (id: string, extra: Ligne = {}) => ({
  id, commune_id: 'c1', role: 'citoyen', email: `${id}@ex.fr`, prenom: id, nom: 'X',
  created_at: '2026-01-01T00:00:00.000Z', compte_supprime_le: null, derniere_connexion_streak: null,
  avertissement_inactivite_le: null, ...extra,
});
const user = (id: string) => db.users.find((u) => u.id === id)!;

beforeEach(() => {
  db = {
    communes: [{ id: 'c1', nom: 'Commune Un', slug: 'un' }, { id: 'demo', nom: 'Bonvivre', slug: 'bonvivre', acces_libre: true }],
    users: [],
  };
  emails = [];
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Avertissement 30 jours avant les 3 ans', () => {
  it('avertit un habitant sans connexion depuis près de 3 ans, avec la date de suppression', async () => {
    db.users.push(habitant('ancien', { derniere_connexion_streak: '2027-05-01' }));
    await purgerHabitantsInactifs(ENV, MAINTENANT);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('ancien@ex.fr');
    expect(emails[0].html).toContain('1 juillet 2030');
    expect(emails[0].html).toContain('https://site.test/un/');
    expect(user('ancien').avertissement_inactivite_le).toBe(MAINTENANT.toISOString());
    expect(user('ancien').compte_supprime_le).toBeNull();
  });

  it('avertit aussi un compte jamais ouvert depuis sa création, il y a près de 3 ans', async () => {
    db.users.push(habitant('jamais', { created_at: '2027-05-01T00:00:00.000Z' }));
    await purgerHabitantsInactifs(ENV, MAINTENANT);
    expect(emails).toHaveLength(1);
  });

  it('ne touche ni un habitant actif, ni un compte de la mairie, ni la démo', async () => {
    db.users.push(
      habitant('actif', { derniere_connexion_streak: '2028-01-01' }),
      habitant('elu', { role: 'elu', derniere_connexion_streak: '2026-02-01' }),
      habitant('demo', { commune_id: 'demo', derniere_connexion_streak: '2026-02-01' }),
    );
    await purgerHabitantsInactifs(ENV, MAINTENANT);
    expect(emails).toHaveLength(0);
    expect(db.users.every((u) => !u.avertissement_inactivite_le && !u.compte_supprime_le)).toBe(true);
  });

  it('un avertissement d\'une inactivité passée (avant reconnexion) ne compte plus', async () => {
    db.users.push(habitant('revenu', { derniere_connexion_streak: '2027-05-01', avertissement_inactivite_le: '2026-03-01T00:00:00.000Z' }));
    await purgerHabitantsInactifs(ENV, MAINTENANT);
    expect(emails).toHaveLength(1);
    expect(user('revenu').compte_supprime_le).toBeNull();
  });

  it('pas de second avertissement pendant le préavis', async () => {
    db.users.push(habitant('averti', { derniere_connexion_streak: '2027-05-01', avertissement_inactivite_le: '2030-05-20T03:00:00.000Z' }));
    await purgerHabitantsInactifs(ENV, MAINTENANT);
    expect(emails).toHaveLength(0);
    expect(user('averti').compte_supprime_le).toBeNull();
  });
});

describe('Anonymisation après le préavis', () => {
  it('anonymise un habitant averti il y a plus de 30 jours et jamais revenu', async () => {
    db.users.push(habitant('parti', { derniere_connexion_streak: '2027-04-01', avertissement_inactivite_le: '2030-04-15T03:00:00.000Z' }));
    await purgerHabitantsInactifs(ENV, MAINTENANT);
    expect(user('parti').compte_supprime_le).toBeTruthy();
    expect(user('parti').email).toBe('supprime-parti@anonyme.local');
  });

  it('garde le compte s\'il s\'est reconnecté après l\'avertissement', async () => {
    db.users.push(habitant('sauve', { derniere_connexion_streak: '2030-05-10', avertissement_inactivite_le: '2030-04-15T03:00:00.000Z' }));
    await purgerHabitantsInactifs(ENV, MAINTENANT);
    expect(user('sauve').compte_supprime_le).toBeNull();
    expect(emails).toHaveLength(0);
  });

  it('n\'anonymise jamais sans avertissement préalable', async () => {
    db.users.push(habitant('oublie', { derniere_connexion_streak: '2026-02-01' }));
    await purgerHabitantsInactifs(ENV, MAINTENANT);
    expect(user('oublie').compte_supprime_le).toBeNull();
    expect(emails).toHaveLength(1); // il est d'abord averti
  });
});

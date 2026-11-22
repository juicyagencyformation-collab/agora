// worker/test/avoirs.test.ts
// Factures d'avoir (2026-11-22, migration 118) : annulation totale ou partielle d'une facture,
// numérotation dédiée sans trou, plafond = ce qui reste dû, facture « annulee » une fois couverte,
// statut figé ensuite, remboursement seulement si la facture était payée, échéance reculée.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import facturation from '../src/backoffice/facturation';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };
const COMMUNE = '11111111-1111-4111-8111-111111111111';
const FACTURE = '22222222-2222-4222-8222-222222222222';
const ANNEE = new Date().getFullYear();

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre.startsWith('like.')) return String(valeur ?? '').startsWith(filtre.slice(5).replace('*', ''));
  return true;
}
function filtrer(t: Ligne[], p: URLSearchParams) {
  let lignes = t.filter((l) => [...p.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || correspond(l[k], v)));
  const ordre = p.get('order');
  if (ordre?.endsWith('.desc')) { const cle = ordre.slice(0, -5); lignes = [...lignes].sort((a, b) => String(b[cle]).localeCompare(String(a[cle]))); }
  if (p.get('limit')) lignes = lignes.slice(0, Number(p.get('limit')));
  return lignes;
}

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const ok = (d: any, s = 200) => Promise.resolve(new Response(JSON.stringify(d), { status: s }));
  const methode = init?.method || 'GET';
  if (methode === 'GET') return ok(filtrer(db[table] || [], url.searchParams));
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const lignes = (Array.isArray(corps) ? corps : [corps]).map((l) => ({ id: crypto.randomUUID(), statut: table === 'avoirs' ? 'emis' : undefined, created_at: new Date().toISOString(), ...l }));
    (db[table] ??= []).push(...lignes);
    return ok(lignes, 201);
  }
  if (methode === 'PATCH') {
    const lignes = filtrer(db[table] || [], url.searchParams);
    lignes.forEach((l) => Object.assign(l, JSON.parse(String(init.body))));
    return ok(lignes);
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const entetes = async () => ({
  Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
  'Content-Type': 'application/json',
});
const emettre = async (corps: any) => facturation.request(`/factures/${FACTURE}/avoirs`, { method: 'POST', headers: await entetes(), body: JSON.stringify(corps) }, ENV);
const patcher = async (chemin: string, corps: any) => facturation.request(chemin, { method: 'PATCH', headers: await entetes(), body: JSON.stringify(corps) }, ENV);

beforeEach(() => {
  db = {
    staff_backoffice: [{ id: 's1', role: 'admin' }],
    communes: [{ id: COMMUNE, nom: 'Eaucourt', prochaine_echeance: '2027-11-20' }],
    factures: [{
      id: FACTURE, numero: `F-${ANNEE}-0001`, commune_id: COMMUNE, nom_destinataire: 'Mairie d\'Eaucourt', adresse_destinataire: '1 place',
      objet: 'Abonnement annuel', montant_ht: 570, taux_tva: 0, montant_ttc: 570, date_emission: '2026-08-18',
      statut: 'emise', payee_le: null, duree_engagement_mois: 12, created_at: '2026-08-18T10:00:00Z',
    }],
    avoirs: [], journal_activite: [], parametres_facturation: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /factures/:id/avoirs', () => {
  it('annulation totale : avoir A- numéroté, identité recopiée, facture annulée', async () => {
    const res = await emettre({ motif: 'Facture de test émise par erreur' });
    expect(res.status).toBe(201);
    expect(db.avoirs).toHaveLength(1);
    expect(db.avoirs[0]).toMatchObject({
      numero: `A-${ANNEE}-0001`, facture_id: FACTURE, commune_id: COMMUNE, nom_destinataire: 'Mairie d\'Eaucourt',
      type: 'total', montant_ttc: 570, montant_ht: 570, motif: 'Facture de test émise par erreur', echeance_reculee: false,
    });
    expect(db.factures[0].statut).toBe('annulee');
    expect(db.factures[0].annulee_le).toBeTruthy();
    expect(db.journal_activite).toHaveLength(1);
    // Une facture annulée ne reçoit plus d'avoir, et son statut ne bouge plus.
    expect((await emettre({ motif: 'Encore' })).status).toBe(400);
    expect((await patcher(`/factures/${FACTURE}`, { statut: 'payee' })).status).toBe(409);
  });

  it('avoirs partiels successifs, plafonnés au reste dû, numérotés à la suite', async () => {
    expect((await emettre({ montant_ttc: 100, motif: 'Geste commercial' })).status).toBe(201);
    expect(db.factures[0].statut).toBe('emise');
    expect((await emettre({ montant_ttc: 500, motif: 'Trop' })).status).toBe(400);
    expect((await emettre({ montant_ttc: 470, motif: 'Le reste' })).status).toBe(201);
    expect(db.avoirs.map((a) => [a.numero, a.type])).toEqual([[`A-${ANNEE}-0001`, 'partiel'], [`A-${ANNEE}-0002`, 'partiel']]);
    expect(db.factures[0].statut).toBe('annulee');
    const { factures } = await (await facturation.request(`/factures?commune_id=${COMMUNE}`, { headers: await entetes() }, ENV)).json() as any;
    expect(factures[0]).toMatchObject({ total_avoirs_ttc: 570, reste_ttc: 0 });
    expect(factures[0].avoirs).toHaveLength(2);
  });

  it('calcule le HT depuis le TTC quand la facture porte de la TVA', async () => {
    Object.assign(db.factures[0], { montant_ht: 100, taux_tva: 20, montant_ttc: 120 });
    await emettre({ montant_ttc: 60, motif: 'Moitié' });
    expect(db.avoirs[0]).toMatchObject({ montant_ttc: 60, montant_ht: 50, taux_tva: 20 });
  });

  it('facture payée puis annulée : échéance reculée sur demande, remboursement suivi', async () => {
    Object.assign(db.factures[0], { statut: 'payee', payee_le: '2026-09-01T10:00:00Z' });
    expect((await emettre({ motif: 'Résiliation', reculer_echeance: true })).status).toBe(201);
    expect(db.communes[0].prochaine_echeance).toBe('2026-11-20');
    expect(db.avoirs[0].echeance_reculee).toBe(true);
    expect((await patcher(`/avoirs/${db.avoirs[0].id}`, { statut: 'rembourse' })).status).toBe(200);
    expect(db.avoirs[0].rembourse_le).toBeTruthy();
  });

  it('ne recule jamais l\'échéance pour un avoir partiel ou une facture non payée', async () => {
    await emettre({ montant_ttc: 70, motif: 'Partiel', reculer_echeance: true });
    expect(db.communes[0].prochaine_echeance).toBe('2027-11-20');
    // Non payée : rien à rembourser.
    expect((await patcher(`/avoirs/${db.avoirs[0].id}`, { statut: 'rembourse' })).status).toBe(400);
    expect((await patcher(`/avoirs/${db.avoirs[0].id}`, { statut: 'depose_chorus' })).status).toBe(200);
    expect(db.avoirs[0].deposee_chorus_le).toBeTruthy();
  });

  it('refuse sans motif, un champ inconnu, un assistant ou une facture inconnue', async () => {
    expect((await emettre({ motif: '' })).status).toBe(400);
    expect((await emettre({ motif: 'Valide', supprimer: true })).status).toBe(400);
    db.staff_backoffice[0].role = 'assistant';
    expect((await emettre({ motif: 'Valide' })).status).toBe(403);
    db.staff_backoffice[0].role = 'admin';
    expect((await facturation.request('/factures/inconnue/avoirs', { method: 'POST', headers: await entetes(), body: JSON.stringify({ motif: 'Valide' }) }, ENV)).status).toBe(404);
    expect(db.avoirs).toHaveLength(0);
  });
});

describe('PATCH /factures/:id', () => {
  it('« payée » deux fois n\'avance l\'échéance qu\'une seule fois', async () => {
    await patcher(`/factures/${FACTURE}`, { statut: 'payee' });
    expect(db.communes[0].prochaine_echeance).toBe('2028-11-20');
    await patcher(`/factures/${FACTURE}`, { statut: 'payee' });
    expect(db.communes[0].prochaine_echeance).toBe('2028-11-20');
  });
});

describe('export CSV', () => {
  it('liste les avoirs en montants négatifs, avec la facture corrigée', async () => {
    await emettre({ montant_ttc: 70, motif: 'Geste' });
    const csv = await (await facturation.request('/factures-export.csv', { headers: await entetes() }, ENV)).text();
    expect(csv).toContain(`A-${ANNEE}-0001`);
    expect(csv).toContain(`Avoir sur F-${ANNEE}-0001 — Geste`);
    expect(csv).toContain('-70');
  });
});

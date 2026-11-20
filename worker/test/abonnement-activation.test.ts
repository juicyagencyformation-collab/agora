// worker/test/abonnement-activation.test.ts
// Bloc « 💶 Abonnement » de la fiche commune (2026-11-20) : « Activer et facturer » applique ce
// que la mairie a commandé sur le devis (formule, commune fondatrice, prix) et émet la facture.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import facturation from '../src/backoffice/facturation';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };
const AUJOURDHUI = new Date().toISOString().slice(0, 10);
const COMMUNE = '11111111-1111-4111-8111-111111111111';
const DEVIS = '22222222-2222-4222-8222-222222222222';

const filtrer = (t: Ligne[], p: URLSearchParams) => t.filter((l) => [...p.entries()]
  .every(([k, v]) => ['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k) || !v.startsWith('eq.') || String(l[k]) === v.slice(3)));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const ok = (d: any, s = 200) => Promise.resolve(new Response(JSON.stringify(d), { status: s }));
  const methode = init?.method || 'GET';
  if (methode === 'GET') return ok(filtrer(db[table] || [], url.searchParams));
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const lignes = (Array.isArray(corps) ? corps : [corps]).map((l) => ({ id: crypto.randomUUID(), ...l }));
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

const activer = async (corps: any = { devis_id: DEVIS }) => facturation.request(`/communes/${COMMUNE}/activer-abonnement`, {
  method: 'POST', body: JSON.stringify(corps),
  headers: {
    Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
    'Content-Type': 'application/json',
  },
}, ENV);

beforeEach(() => {
  db = {
    staff_backoffice: [{ id: 's1', role: 'admin' }],
    communes: [{ id: COMMUNE, nom: 'Huppy', forfait: 'Gratuit', formule: null, prix_annuel_ttc: null, prochaine_echeance: null }],
    devis: [{
      id: DEVIS, commune_id: COMMUNE, numero: 'D-2026-0001', statut: 'envoye', formule: 'autonomie', fondatrice: false,
      nom_destinataire: 'Huppy', objet: 'Abonnement annuel Plateforme-Agora — Autonomie', montant_ht: 350, taux_tva: 0,
      montant_ttc: 350, duree_engagement_mois: 12, bon_commande_recu_le: '2026-11-20T09:00:00Z', facture_id: null,
    }],
    demandes_formule: [{ commune_id: COMMUNE, statut: 'en_attente' }],
    prospects: [{ id: 'p1', commune_id: COMMUNE, statut: 'contacte', prochaine_relance_le: '2026-11-21', prochaine_relance_heure: '10:00' }],
    factures: [], onglets_config: [], journal_activite: [], parametres_facturation: [], prospect_interactions: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /communes/:id/activer-abonnement', () => {
  it('active la formule commandée et émet la facture, en un geste', async () => {
    const res = await activer();
    expect(res.status).toBe(201);
    expect(db.communes[0]).toMatchObject({
      forfait: 'Version complète', formule: 'autonomie', prix_annuel_ttc: 350,
      duree_engagement_mois: 12, prochaine_echeance: AUJOURDHUI, statut_client: 'active',
    });
    expect(db.communes[0].derniere_relance_echeance_le).toBeTruthy(); // pas de rappel en plus de la facture
    expect(db.onglets_config.length).toBeGreaterThan(10);
    expect(db.onglets_config.every((o) => o.actif)).toBe(true);
    expect(db.factures).toHaveLength(1);
    expect(db.factures[0]).toMatchObject({ commune_id: COMMUNE, montant_ttc: 350 });
    expect(db.devis[0]).toMatchObject({ statut: 'accepte', facture_id: db.factures[0].id });
    expect(db.demandes_formule[0].statut).toBe('traitee');
    // Le prospect sort des appels du jour.
    expect(db.prospects[0]).toMatchObject({ statut: 'gagne', prochaine_relance_le: null, prochaine_relance_heure: null });
    expect(db.prospect_interactions).toHaveLength(1);
  });

  it('fondatrice qui renouvelle : prix gardé, date anniversaire inchangée', async () => {
    Object.assign(db.communes[0], { forfait: 'Fondateur', prochaine_echeance: '2027-01-15' });
    Object.assign(db.devis[0], { fondatrice: true, montant_ht: 227.37, montant_ttc: 227.37 });
    expect((await activer()).status).toBe(201);
    expect(db.communes[0]).toMatchObject({ forfait: 'Fondateur', prix_annuel_ttc: 227.37, prochaine_echeance: '2027-01-15' });
  });

  it('refuse sans bon de commande, un devis manuel ou déjà facturé, et un assistant', async () => {
    db.devis[0].bon_commande_recu_le = null;
    expect((await activer()).status).toBe(400);
    Object.assign(db.devis[0], { bon_commande_recu_le: '2026-11-20T09:00:00Z', formule: null });
    expect((await activer()).status).toBe(400);
    Object.assign(db.devis[0], { formule: 'autonomie', facture_id: 'f-existante' });
    expect((await activer()).status).toBe(400);
    db.devis[0].facture_id = null;
    db.staff_backoffice[0].role = 'assistant';
    expect((await activer()).status).toBe(403);
    expect(db.factures).toHaveLength(0);
    expect(db.communes[0].forfait).toBe('Gratuit');
  });

  it('ignore un devis d\'une autre commune', async () => {
    db.devis[0].commune_id = '33333333-3333-4333-8333-333333333333';
    expect((await activer()).status).toBe(404);
  });
});

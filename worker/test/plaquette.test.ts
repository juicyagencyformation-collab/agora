// worker/test/plaquette.test.ts
// Plaquette personnalisée (backoffice/plaquette.ts) : prix de la commune d'après le barème, prix de
// la convention s'il est plus bas, places fondatrices restantes, cas « sur devis » et « gratuit à vie ».
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import plaquette from '../src/backoffice/plaquette';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333333';

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  if (filtre === 'not.is.null') return valeur !== null && valeur !== undefined;
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  return true;
}
function fetchFake(input: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const lignes = (db[table] || []).filter((l) => [...url.searchParams.entries()]
    .every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || correspond(l[k], v)));
  return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
}
const session = async () => ({ Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}` });
const lire = async (q: string) => plaquette.request('/?' + q, { headers: await session() }, ENV);

beforeEach(() => {
  db = {
    prospects: [
      { id: P1, nom: 'Saint-Martin', departement: '60', population: 1450, commune_id: null },
      { id: P2, nom: 'Tourly', departement: '60', population: 180, commune_id: C1 },
    ],
    communes: [{ id: C1, nom: 'Tourly', slug: 'tourly', population: 180, departement: '60', logo_url: 'https://cdn.plateforme-agora.fr/x/logo.png', couleur_theme: '#7a2e3b', couleur_accent: '#f2c14e', forfait: 'Fondateur' }],
    conventions: [{ commune_id: 'autre-1', numero_fondatrice: 1, statut: 'signee' }, { commune_id: 'autre-2', numero_fondatrice: 2, statut: 'envoyee' }],
    parametres_facturation: [], modeles_email: [],
    onglets_gratuits: ['actualites', 'alertes', 'agenda', 'chasse_tresor', 'enigmes'].map((cle) => ({ cle })),
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('plaquette personnalisée', () => {
  it('refuse sans session staff et sans un seul identifiant valide', async () => {
    expect((await plaquette.request('/?prospect=' + P1, {}, ENV)).status).toBe(401);
    expect((await lire('')).status).toBe(400);
    expect((await lire(`prospect=${P1}&commune=${C1}`)).status).toBe(400);
    expect((await lire('prospect=pas-un-uuid')).status).toBe(400);
  });

  it('prospect sans espace : prix du barème selon sa population, places restantes', async () => {
    const d = await (await lire('prospect=' + P1)).json() as any;
    expect(d.commune).toMatchObject({ nom: 'Saint-Martin', slug: null, habitants: 1450, departement_nom: 'Oise' });
    expect(d.tarifs).toMatchObject({ autonomie: 307, accompagne: 507, fondateur_autonomie: 199.55, fondateur_accompagne: 329.55, sur_devis: false, gratuite_a_vie: false });
    expect(d.fondatrice).toMatchObject({ proposee: true, places_restantes: 8, places_total: 10 });
    expect(d.onglets_gratuits).toContain('agenda');
    expect(d.offres.autonomie.features.length).toBeGreaterThan(0);
  });

  it('commune avec convention : couleurs et logo, prix de la convention s\'il est plus bas, sa place comptée', async () => {
    db.conventions.push({ commune_id: C1, numero_fondatrice: 3, statut: 'envoyee', prix_annuel_fondateur: 150 });
    const d = await (await lire('prospect=' + P2)).json() as any;
    expect(d.commune).toMatchObject({ slug: 'tourly', couleur_theme: '#7a2e3b', logo_url: 'https://cdn.plateforme-agora.fr/x/logo.png' });
    expect(d.tarifs).toMatchObject({ autonomie: 250, fondateur_autonomie: 150, prix_convention: true });
    expect(d.fondatrice).toMatchObject({ convention_en_cours: true, places_restantes: 7 });
    db.conventions[2].prix_annuel_fondateur = 188.5; // plus cher que le barème −35 % : le barème l'emporte
    const d2 = await (await lire('commune=' + C1)).json() as any;
    expect(d2.tarifs).toMatchObject({ fondateur_autonomie: 162.5, prix_convention: false });
  });

  it('sur devis au-delà de 5 000 habitants (pas d\'offre fondatrice), gratuit à vie sous 100', async () => {
    db.prospects[0].population = 8000;
    const devis = await (await lire('prospect=' + P1)).json() as any;
    expect(devis.tarifs.sur_devis).toBe(true);
    expect(devis.fondatrice.proposee).toBe(false);
    db.prospects[0].population = 60;
    const petite = await (await lire('prospect=' + P1)).json() as any;
    expect(petite.tarifs).toMatchObject({ gratuite_a_vie: true, autonomie: 0, fondateur_autonomie: 0, accompagne: 200, fondateur_accompagne: 130 });
  });
});

// worker/test/contrat-dpa.test.ts
// Contrat DPA : trous étiquetés, reprise des sources existantes (convention, annuaire), saisie du
// panneau (validée, enregistrée par commune ou pour le Prestataire), valeurs toujours échappées.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import facturation from '../src/backoffice/facturation';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };

const correspond = (l: Ligne, k: string, v: string) => {
  if (v.startsWith('eq.')) return String(l[k]) === v.slice(3);
  if (v.startsWith('neq.')) return String(l[k]) !== v.slice(4);
  if (v === 'is.null') return l[k] == null;
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(l[k]));
  return true;
};
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const conflit = url.searchParams.get('on_conflict');
    for (const ligne of Array.isArray(corps) ? corps : [corps]) {
      const existante = conflit && (db[table] ??= []).find((l) => l[conflit] === ligne[conflit]);
      if (existante) Object.assign(existante, ligne); else (db[table] ??= []).push({ ...ligne });
    }
    return Promise.resolve(new Response('[]', { status: 201 }));
  }
  const colonnes = (url.searchParams.get('select') || '').split(',');
  const lignes = (db[table] || [])
    .filter((l) => [...url.searchParams.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || correspond(l, k, v)))
    .map((l) => Object.fromEntries(colonnes.filter((c) => c in l).map((c) => [c, l[c]])));
  return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
}
const session = async () => ({ Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}` });
const lire = async () => (await facturation.request('/contrat-dpa/fay', { headers: await session() }, ENV)).json() as Promise<any>;
const ecrire = async (corps: object) => facturation.request('/contrat-dpa/fay', {
  method: 'PUT', headers: { ...(await session()), 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
}, ENV);

beforeEach(() => {
  db = {
    communes: [{ id: 'fay', nom: 'Fay-les-Étangs', population: 220, telephone_mairie: '03 44 00 00 00' }],
    parametres_facturation: [{ cle: 'entreprise_siret', valeur: '123456789' }, { cle: 'entreprise_adresse', valeur: '1 rue X' },
      { cle: 'entreprise_cp_ville', valeur: '80000 Amiens' }, { cle: 'entreprise_telephone', valeur: '06 00 00 00 00' }],
    dpa_communes: [],
    users: [{ commune_id: 'fay', role: 'maire', prenom: 'Marie', nom: 'Dupont', compte_supprime_le: null }],
    prospects: [{ commune_id: 'fay', nom_maire: 'Marie Dupont', maire_civilite: 'Mme', adresse: '2 place de la Mairie, 60240 Fay-les-Étangs' }],
    conventions: [{ commune_id: 'fay', statut: 'brouillon', siret_commune: '21600228500011', deliberation_reference: '2026-45', deliberation_date: '2026-10-12' }],
    journal_activite: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Contrat DPA — informations à compléter', () => {
  it('reprend les sources existantes et étiquette les trous restants', async () => {
    const d = await lire();
    const champ = (cle: string) => d.champs.find((ch: any) => ch.cle === cle);
    expect(champ('siret_commune')).toMatchObject({ valeur: '21600228500011', source: 'convention' });
    expect(champ('habilitation').valeur).toBe('la délibération n° 2026-45 du 12 octobre 2026');
    expect(champ('adresse_mairie').source).toBe('annuaire');
    expect(champ('telephone_alerte').valeur).toBe('03 44 00 00 00');
    expect(champ('signataire_qualite').valeur).toBe('maire');
    expect(d.html).toContain('Mme Marie Dupont, maire');
    // Restent : DPO, plafond, assurance
    expect(d.manquants).toBe(3);
    expect(d.html).toContain('data-champ="dpo"');
    expect(d.html).toContain('[● DPO de la commune]');
    expect(d.html).not.toContain('[●]');
  });

  it('enregistre la saisie, complète le contrat et échappe les valeurs', async () => {
    const res = await ecrire({ dpo: 'CDG 60 <script>x</script>', dpa_plafond_responsabilite: '10 000 €', dpa_assurance: 'engagement', siret_commune: '216 002 285 00011' });
    expect(res.status).toBe(200);
    expect(db.dpa_communes[0]).toMatchObject({ commune_id: 'fay', dpo: 'CDG 60 <script>x</script>', siret_commune: '21600228500011' });
    expect(db.parametres_facturation.find((p) => p.cle === 'dpa_plafond_responsabilite')?.valeur).toBe('10000');
    expect(db.journal_activite[0]).toMatchObject({ action: 'contrat_dpa_infos' });
    const d = await lire();
    expect(d.manquants).toBe(0);
    expect(d.html).not.toContain('class="a-completer"');
    expect(d.html).toContain('10 000 euros');
    expect(d.html).toContain('numéro SIREN 123456789,');
    expect(d.html).toContain("s'engage à souscrire une police");
    expect(d.html).toContain('CDG 60 &lt;script&gt;');
    expect(d.html).not.toContain('<script>x');
    expect(d.champs.find((ch: any) => ch.cle === 'dpo').source).toBeNull();
  });

  it('refuse un SIRET faux, un plafond non numérique, une assurance inconnue ou un champ inconnu', async () => {
    expect((await ecrire({ siret_commune: '1234' })).status).toBe(400);
    expect((await ecrire({ dpa_plafond_responsabilite: 'beaucoup' })).status).toBe(400);
    expect((await ecrire({ dpa_assurance: 'peut-être' })).status).toBe(400);
    expect((await ecrire({ commune_id: 'autre' })).status).toBe(400);
    expect(db.dpa_communes).toHaveLength(0);
  });

  it('refuse sans session staff', async () => {
    expect((await facturation.request('/contrat-dpa/fay', {}, ENV)).status).toBe(401);
  });
});

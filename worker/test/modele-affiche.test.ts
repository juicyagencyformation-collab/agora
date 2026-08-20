// worker/test/modele-affiche.test.ts
// Couvre chargerAfficheCitoyens (voir src/backoffice/modele-affiche.ts) : contrairement à la
// fiche de présentation commerciale (modele-fiche.ts, logo/branding Agora), l'affiche citoyenne
// doit utiliser le nom et le LOGO DE LA COMMUNE elle-même — c'est le point central à vérifier ici.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chargerAfficheCitoyens, MODELE_AFFICHE_CITOYENS_DEFAUT } from '../src/backoffice/modele-affiche';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  return true;
}

function fetchFake(input: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  let lignes = [...(db[table] || [])];
  for (const [cle, valeur] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
}

const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };

beforeEach(() => {
  db = { communes: [], modeles_email: [] };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chargerAfficheCitoyens', () => {
  it('renvoie le nom et le logo DE LA COMMUNE (pas la marque Agora)', async () => {
    db.communes.push({ slug: 'eaucourt', nom: 'Eaucourt-sur-Somme', logo_url: 'https://r2.example/eaucourt-logo.png' });

    const r = await chargerAfficheCitoyens(ENV, 'eaucourt');

    expect(r.commune_nom).toBe('Eaucourt-sur-Somme');
    expect(r.logo_url).toBe('https://r2.example/eaucourt-logo.png');
    expect(r.contenu_html).toBe(MODELE_AFFICHE_CITOYENS_DEFAUT);
  });

  it('utilise le contenu personnalisé stocké en base s\'il existe', async () => {
    db.communes.push({ slug: 'eaucourt', nom: 'Eaucourt-sur-Somme', logo_url: null });
    db.modeles_email.push({ cle: 'affiche_citoyens', actif: true, corps_html: '<p>{{commune}} personnalisé</p>' });

    const r = await chargerAfficheCitoyens(ENV, 'eaucourt');

    expect(r.contenu_html).toBe('<p>{{commune}} personnalisé</p>');
  });

  it('reste résilient si la commune est introuvable (nom/logo vides, contenu par défaut quand même)', async () => {
    const r = await chargerAfficheCitoyens(ENV, 'inconnue');

    expect(r.commune_nom).toBeNull();
    expect(r.logo_url).toBeNull();
    expect(r.contenu_html).toBe(MODELE_AFFICHE_CITOYENS_DEFAUT);
  });

  it('ignore un modèle personnalisé désactivé', async () => {
    db.communes.push({ slug: 'eaucourt', nom: 'Eaucourt-sur-Somme', logo_url: null });
    db.modeles_email.push({ cle: 'affiche_citoyens', actif: false, corps_html: '<p>désactivé</p>' });

    const r = await chargerAfficheCitoyens(ENV, 'eaucourt');

    expect(r.contenu_html).toBe(MODELE_AFFICHE_CITOYENS_DEFAUT);
  });
});

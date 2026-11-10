// worker/test/marque-commune.test.ts
import { describe, it, expect } from 'vitest';
import { marqueCommune, dimensionsPng } from '../src/lib/marque-commune';

const base = 'https://cdn.plateforme-agora.fr/abc';

describe('marqueCommune', () => {
  it('offre complète ou fondatrice active avec logo : logo + icône voisine, même version', () => {
    expect(marqueCommune({ logo_url: `${base}/logo.png?v=12`, forfait: 'Version complète', statut_client: 'active' }))
      .toEqual({ logo_url: `${base}/logo.png?v=12`, icone_url: `${base}/icone.png?v=12` });
    expect(marqueCommune({ logo_url: `${base}/logo.jpeg`, forfait: 'Fondateur', statut_client: 'active' })?.icone_url)
      .toBe(`${base}/icone.png`);
  });
  it('rien pour une commune gratuite, sans forfait, non active ou sans logo', () => {
    expect(marqueCommune({ logo_url: `${base}/logo.png`, forfait: 'Gratuit', statut_client: 'active' })).toBeNull();
    expect(marqueCommune({ logo_url: `${base}/logo.png`, forfait: null, statut_client: 'active' })).toBeNull();
    expect(marqueCommune({ logo_url: `${base}/logo.png`, forfait: 'Version complète', statut_client: 'resiliee' })).toBeNull();
    expect(marqueCommune({ logo_url: null, forfait: 'Fondateur', statut_client: 'active' })).toBeNull();
  });
  it("jamais le logo lui-même comme icône si son adresse n'a pas la forme attendue", () => {
    expect(marqueCommune({ logo_url: `${base}/autre.png`, forfait: 'Fondateur', statut_client: 'active' })?.icone_url).toBeNull();
  });
});

describe('dimensionsPng', () => {
  it("lit la taille dans l'en-tête PNG et refuse un autre format", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 512);
    new DataView(png.buffer).setUint32(20, 512);
    expect(dimensionsPng(png)).toEqual({ largeur: 512, hauteur: 512 });
    expect(dimensionsPng(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

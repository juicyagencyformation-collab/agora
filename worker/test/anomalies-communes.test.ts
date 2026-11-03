// worker/test/anomalies-communes.test.ts
// Couvre detecterAnomalies (src/backoffice/suivi-communes.ts) : les incohérences trouvées à la
// main le 2026-11-03 (formule jamais renseignée, fondatrice sans convention, commune en double,
// fondatrice de 44 000 habitants...) doivent remonter seules sur la page Aujourd'hui.
import { describe, it, expect } from 'vitest';
import { detecterAnomalies } from '../src/backoffice/suivi-communes';

const MAINTENANT = new Date('2026-11-03T12:00:00Z').getTime();
const commune = (o: Record<string, any>) => ({ statut_client: 'active', formule: 'autonomie', population: 400, prix_annuel_ttc: 290, slug: o.id, ...o });
const codes = (anomalies: any[], id?: string) => anomalies.filter((a) => !id || a.commune_id === id).map((a) => a.code).sort();

describe('detecterAnomalies', () => {
  it('ne signale rien pour une commune en ordre', () => {
    const fay = commune({ id: 'fay', nom: 'Fay', forfait: 'Fondateur' });
    expect(detecterAnomalies([fay], [{ commune_id: 'fay', statut: 'signee', created_at: '2026-10-01' }], new Map(), MAINTENANT)).toEqual([]);
  });

  it('signale la formule manquante, le prix manquant et le DPA incomplet', () => {
    const payante = commune({ id: 'p', nom: 'Payante', forfait: 'Version complète', formule: null, prix_annuel_ttc: null });
    const anomalies = detecterAnomalies([payante], [], new Map([['p', 2]]), MAINTENANT);
    expect(codes(anomalies)).toEqual(['dpa_incomplet', 'formule_manquante', 'prix_manquant']);
    expect(anomalies[0].gravite).toBe('haute'); // les plus graves d'abord
  });

  it('signale une fondatrice sans convention ou hors cible, et une convention qui traîne', () => {
    const sans = commune({ id: 'sans', nom: 'Sans', forfait: 'Fondateur' });
    const grande = commune({ id: 'istres', nom: 'Istres', forfait: 'Fondateur', population: 44292 });
    const traine = commune({ id: 'traine', nom: 'Traine', forfait: 'Fondateur' });
    const conventions = [
      { commune_id: 'istres', statut: 'signee', created_at: '2026-10-01' },
      { commune_id: 'traine', statut: 'brouillon', created_at: '2026-09-01' },
    ];
    const anomalies = detecterAnomalies([sans, grande, traine], conventions, new Map(), MAINTENANT);
    expect(codes(anomalies, 'sans')).toEqual(['convention_manquante']);
    expect(codes(anomalies, 'istres')).toEqual(['fondatrice_hors_cible']);
    expect(codes(anomalies, 'traine')).toEqual(['convention_en_attente']);
  });

  it('repère une commune en double, accents et tirets compris', () => {
    const a = commune({ id: 'a', nom: 'Eaucourt-sur-Somme', forfait: 'Version complète' });
    const b = commune({ id: 'b', nom: 'Eaucourt sur Somme', forfait: 'Fondateur' });
    const anomalies = detecterAnomalies([a, b], [{ commune_id: 'b', statut: 'signee', created_at: '2026-10-01' }], new Map(), MAINTENANT);
    expect(codes(anomalies)).toEqual(['doublon', 'doublon']);
  });

  it('signale plus de fondatrices que de places annoncées', () => {
    const fondatrices = Array.from({ length: 11 }, (_, i) => commune({ id: `f${i}`, nom: `Commune ${i}`, forfait: 'Fondateur' }));
    const conventions = fondatrices.map((f) => ({ commune_id: f.id, statut: 'signee', created_at: '2026-10-01' }));
    const anomalies = detecterAnomalies(fondatrices, conventions, new Map(), MAINTENANT);
    expect(codes(anomalies)).toEqual(['places_fondatrices']);
    expect(anomalies[0].commune_id).toBeNull();
  });
});

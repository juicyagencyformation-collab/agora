// worker/src/backoffice/avoirs.ts
// Factures d'avoir (2026-11-22, migration 118) — calculs partagés entre facturation.ts (routes des
// avoirs, listes de factures) et administration.ts (page Aujourd'hui, chiffre d'affaires) : un
// module à part évite un import circulaire entre ces deux fichiers.
import { supabaseSelect } from '../db';

export const COLONNES_AVOIR = 'id,numero,facture_id,commune_id,nom_destinataire,adresse_destinataire,motif,type,montant_ht,'
  + 'taux_tva,montant_ttc,date_emission,statut,deposee_chorus_le,rembourse_le,echeance_reculee,created_at';

export const arrondi = (n: number) => Math.round(n * 100) / 100;

// Chaque facture porte ses avoirs, leur total TTC et ce qui reste dû (montant TTC − avoirs).
export async function avecAvoirs<T extends { id: string; montant_ttc: number | string }>(env: any, factures: T[]) {
  if (!factures.length) return [] as (T & { avoirs: any[]; total_avoirs_ttc: number; reste_ttc: number })[];
  const avoirs = await supabaseSelect(env, 'avoirs', {
    select: COLONNES_AVOIR, facture_id: `in.(${factures.map((f) => f.id).join(',')})`, order: 'created_at.asc',
  });
  return factures.map((f) => {
    const siens = avoirs.filter((a: any) => a.facture_id === f.id);
    const total = arrondi(siens.reduce((s: number, a: any) => s + Number(a.montant_ttc), 0));
    return { ...f, avoirs: siens, total_avoirs_ttc: total, reste_ttc: arrondi(Number(f.montant_ttc) - total) };
  });
}

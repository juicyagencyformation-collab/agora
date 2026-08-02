// worker/src/lib/sync-lois.ts
//
// Synchronise le flux RSS officiel de l'Assemblée nationale ("Publications parlementaires")
// vers la table lois. Source vérifiée manuellement le 2026-08-02 :
// http://www2.assemblee-nationale.fr/feeds/detail/documents-parlementaires
//
// Le flux contient TOUS les documents parlementaires (rapports, amendements, comptes rendus...),
// pas seulement les textes de loi — on filtre donc sur le titre pour ne garder que les projets
// et propositions de loi, afin de ne pas noyer le module sous des documents hors sujet.
//
// Important : ce flux n'a pas pu être inspecté finement avant écriture (limite technique),
// le parsing suit le format RSS 2.0 standard. À vérifier via /sync-manuel avant de faire
// confiance à l'automatisation — voir routes/lois.ts.

import { XMLParser } from 'fast-xml-parser';
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';

const FLUX_AN = 'http://www2.assemblee-nationale.fr/feeds/detail/documents-parlementaires';

export async function synchroniserLoisAssembleeNationale(env: any): Promise<{ trouves: number; ajoutes: number; erreurs: string[] }> {
  const erreurs: string[] = [];
  let trouves = 0;
  let ajoutes = 0;

  try {
    const res = await fetch(FLUX_AN, { headers: { 'User-Agent': 'Agora-Plateforme-Civique/1.0' } });
    if (!res.ok) {
      erreurs.push(`Flux AN inaccessible : statut ${res.status}`);
      return { trouves, ajoutes, erreurs };
    }
    const xmlBrut = await res.text();

    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(xmlBrut);
    const items = data?.rss?.channel?.item;
    const liste = Array.isArray(items) ? items : items ? [items] : [];

    // Ne garde que les projets/propositions de loi — pas les rapports, amendements, etc.
    const textesDeLoI = liste.filter((item: any) => {
      const titre = String(item.title ?? '');
      return /projet de loi|proposition de loi/i.test(titre);
    });
    trouves = textesDeLoI.length;

    for (const item of textesDeLoI) {
      const titre = String(item.title ?? '').trim();
      const lien = String(item.link ?? '').trim();
      const description = String(item.description ?? titre).trim();
      const externalId = String(item.guid?.['#text'] ?? item.guid ?? lien).trim();
      if (!titre || !lien || !externalId) continue;

      const [existant] = await supabaseSelect(env, 'lois', {
        select: 'id', source: 'eq.assemblee_nationale', external_id: `eq.${externalId}`,
      });
      if (existant) continue; // déjà connu, on ne duplique pas

      await supabaseInsert(env, 'lois', {
        titre: titre.slice(0, 300),
        description: description.slice(0, 5000),
        source: 'assemblee_nationale',
        statut: 'depose',
        url_source: lien,
        external_id: externalId,
      });
      ajoutes++;
    }
  } catch (err: any) {
    erreurs.push(`Erreur de synchronisation : ${err?.message ?? String(err)}`);
  }

  return { trouves, ajoutes, erreurs };
}

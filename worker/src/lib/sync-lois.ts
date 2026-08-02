// worker/src/lib/sync-lois.ts
//
// Synchronise les flux RSS officiels vers la table lois.
//
// - Assemblée nationale : http://www2.assemblee-nationale.fr/feeds/detail/documents-parlementaires
//   Contient TOUS les documents parlementaires (rapports, amendements, comptes rendus...),
//   pas seulement les textes de loi — on filtre donc sur le titre.
// - Parlement européen : https://www.europarl.europa.eu/rss/doc/texts-adopted/fr.xml
//   Contient uniquement les textes adoptés — pas de filtrage nécessaire.
//
// Les deux vérifiées manuellement le 2026-08-02. Important : leur contenu XML brut n'a pas
// pu être inspecté finement avant écriture (limite technique), le parsing suit le format
// RSS 2.0 standard. À vérifier via /sync-manuel avant de faire confiance à l'automatisation
// — voir routes/lois.ts.

import { XMLParser } from 'fast-xml-parser';
import { supabaseSelect, supabaseInsert } from '../db';

interface ResultatSync { trouves: number; ajoutes: number; erreurs: string[] }

async function synchroniserFlux(
  env: any,
  url: string,
  source: string,
  statutParDefaut: string,
  filtreTitre?: RegExp,
): Promise<ResultatSync> {
  const erreurs: string[] = [];
  let trouves = 0;
  let ajoutes = 0;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Agora-Plateforme-Civique/1.0' } });
    if (!res.ok) {
      erreurs.push(`Flux inaccessible (${source}) : statut ${res.status}`);
      return { trouves, ajoutes, erreurs };
    }
    const xmlBrut = await res.text();

    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(xmlBrut);
    const items = data?.rss?.channel?.item;
    const liste = Array.isArray(items) ? items : items ? [items] : [];

    const filtres = filtreTitre ? liste.filter((item: any) => filtreTitre.test(String(item.title ?? ''))) : liste;
    trouves = filtres.length;

    for (const item of filtres) {
      const titre = String(item.title ?? '').trim();
      const lien = String(item.link ?? '').trim();
      const description = String(item.description ?? titre).trim();
      const externalId = String(item.guid?.['#text'] ?? item.guid ?? lien).trim();
      if (!titre || !lien || !externalId) continue;

      const [existant] = await supabaseSelect(env, 'lois', {
        select: 'id', source: `eq.${source}`, external_id: `eq.${externalId}`,
      });
      if (existant) continue; // déjà connu, on ne duplique pas

      await supabaseInsert(env, 'lois', {
        titre: titre.slice(0, 300),
        description: description.slice(0, 5000),
        source,
        statut: statutParDefaut,
        url_source: lien,
        external_id: externalId,
      });
      ajoutes++;
    }
  } catch (err: any) {
    erreurs.push(`Erreur de synchronisation (${source}) : ${err?.message ?? String(err)}`);
  }

  return { trouves, ajoutes, erreurs };
}

export async function synchroniserLoisAssembleeNationale(env: any): Promise<ResultatSync> {
  return synchroniserFlux(
    env,
    'http://www2.assemblee-nationale.fr/feeds/detail/documents-parlementaires',
    'assemblee_nationale',
    'depose',
    /projet de loi|proposition de loi/i,
  );
}

export async function synchroniserLoisParlementEuropeen(env: any): Promise<ResultatSync> {
  return synchroniserFlux(
    env,
    'https://www.europarl.europa.eu/rss/doc/texts-adopted/fr.xml',
    'parlement_europeen',
    'adopte',
  );
}

// Lance les deux synchros et combine les résultats (utilisé par le cron automatique).
export async function synchroniserToutesLesLois(env: any): Promise<{ an: ResultatSync; ue: ResultatSync }> {
  const [an, ue] = await Promise.all([
    synchroniserLoisAssembleeNationale(env),
    synchroniserLoisParlementEuropeen(env),
  ]);
  return { an, ue };
}

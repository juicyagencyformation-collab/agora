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
// Contenu XML réel inspecté et confirmé le 2026-08-05 : les deux flux sont du RSS 2.0
// standard. Le flux du Parlement européen était bloqué par un WAF (voir le commentaire sur
// le User-Agent plus bas) — pas un problème de format.

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
    // Le Parlement européen bloque les requêtes non-navigateur via un WAF (AWS) qui renvoie
    // un 202 vide plutôt qu'une erreur explicite — d'où le faux diagnostic initial "format XML
    // non reconnu" (on parsait une réponse vide). Confirmé le 2026-08-05 : un User-Agent de
    // navigateur classique suffit à passer, le flux réel est du RSS 2.0 standard (déjà géré
    // ci-dessous). Ne jamais revenir à un User-Agent identifiant l'app.
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml,application/xml,text/xml,*/*;q=0.9',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    });
    if (!res.ok) {
      erreurs.push(`Flux inaccessible (${source}) : statut ${res.status}`);
      return { trouves, ajoutes, erreurs };
    }
    const xmlBrut = await res.text();

    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(xmlBrut);

    // Les institutions n'utilisent pas toutes le même format XML : RSS 2.0 classique
    // (rss > channel > item), RSS 1.0/RDF (rdf:RDF > item, item pas imbriqué dans channel),
    // ou Atom (feed > entry). On essaie les trois avant d'abandonner.
    let liste: any[] = [];
    if (data?.rss?.channel?.item) {
      const items = data.rss.channel.item;
      liste = Array.isArray(items) ? items : [items];
    } else if (data?.['rdf:RDF']?.item) {
      const items = data['rdf:RDF'].item;
      liste = Array.isArray(items) ? items : [items];
    } else if (data?.feed?.entry) {
      // Format Atom : les champs n'ont pas les mêmes noms, on les remappe vers le
      // vocabulaire RSS (title/link/description/guid) utilisé plus bas.
      const entries = Array.isArray(data.feed.entry) ? data.feed.entry : [data.feed.entry];
      liste = entries.map((e: any) => ({
        title: e.title,
        link: e.link?.['@_href'] ?? e.link,
        description: e.summary ?? e.content,
        guid: e.id,
      }));
    }

    const filtres = filtreTitre ? liste.filter((item: any) => filtreTitre.test(String(item.title ?? ''))) : liste;
    trouves = filtres.length;

    if (liste.length === 0) {
      erreurs.push(`Format XML non reconnu (${source}) — clés racine trouvées : ${Object.keys(data).join(', ')}`);
    }

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

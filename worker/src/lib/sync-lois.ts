// worker/src/lib/sync-lois.ts
//
// Synchronise les flux RSS officiels vers la table lois.
//
// - Assemblée nationale : http://www2.assemblee-nationale.fr/feeds/detail/documents-parlementaires
//   Contient TOUS les documents parlementaires (rapports, amendements, comptes rendus...),
//   pas seulement les textes de loi — on filtre donc sur le titre.
// - Parlement européen : https://www.europarl.europa.eu/rss/doc/texts-adopted/fr.xml
//   Contient uniquement les textes adoptés — pas de filtrage nécessaire.
// - Journal officiel (JORF) : https://droit.org/flux/jorf.rss
//   Légifrance n'expose aucun flux RSS officiel direct (vérifié le 2026-08-29 — beaucoup de
//   sources en ligne l'affirment à tort ; l'accès officiel passe par l'API PISTE, OAuth2 +
//   inscription, jugé disproportionné pour ce besoin). droit.org republie le sommaire du dernier
//   JO en RSS 2.0 standard, avec des liens qui pointent vers de vraies pages legifrance.gouv.fr
//   officielles (vérifié en direct) — miroir tiers du contenu officiel, pas une source alternative.
//   Mélange lois/décrets/arrêtés/nominations : filtré sur le titre, seules les vraies lois
//   ("LOI n°...", "Loi organique n°...") sont retenues. Statut "promulguee" — seule source du
//   module qui va jusqu'au bout du cycle de vie (déposé → adopté UE → promulguée en France).
//
// Contenu XML réel inspecté et confirmé le 2026-08-05 (AN + PE) puis le 2026-08-29 (JORF) : les
// trois flux sont du RSS 2.0 standard. Le flux du Parlement européen était bloqué par un WAF (voir
// le commentaire sur le User-Agent plus bas) — pas un problème de format.

import { XMLParser } from 'fast-xml-parser';
import { supabaseSelect, supabaseInsert } from '../db';

interface ResultatSync { trouves: number; ajoutes: number; erreurs: string[] }

// Le flux du Parlement européen encode du HTML dans <description> (&lt;br /&gt;,
// &lt;a href=...&gt;...) — une fois les entités XML décodées par le parseur, ça redevient du
// HTML brut en clair. Stocké tel quel, le frontend (qui traite la description comme du texte
// simple, via escapeAttr côté lois.js) l'affiche échappé : les balises apparaissent en toutes
// lettres au lieu d'être interprétées ou nettoyées. On nettoie donc ici, à la source.
function nettoyerDescriptionHtml(texte: string): string {
  return texte
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gis, '$1') // garde le texte du lien, retire la balise
    .replace(/<[^>]+>/g, '') // filet de sécurité pour toute autre balise résiduelle
    .replace(/\s+/g, ' ')
    .trim();
}

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

    // Un SELECT + un INSERT par item dépasse vite la limite Cloudflare de sous-requêtes par
    // invocation (ex: 25 items du Parlement européen ≈ 50 sous-requêtes rien que pour ce
    // flux, en plus de celui de l'Assemblée nationale synchronisé dans la même invocation).
    // On normalise tout en mémoire d'abord, puis un seul SELECT groupé + un seul INSERT groupé.
    const candidats = filtres
      .map((item: any) => ({
        titre: String(item.title ?? '').trim(),
        lien: String(item.link ?? '').trim(),
        description: nettoyerDescriptionHtml(String(item.description ?? item.title ?? '').trim()),
        externalId: String(item.guid?.['#text'] ?? item.guid ?? item.link ?? '').trim(),
      }))
      .filter((c: any) => c.titre && c.lien && c.externalId);

    if (candidats.length) {
      // Valeurs entre guillemets pour le filtre PostgREST in.() : un external_id contenant
      // une virgule ou une parenthèse casserait sinon la liste.
      const listeIds = candidats.map((c: any) => `"${c.externalId.replace(/"/g, '\\"')}"`).join(',');
      const existants = await supabaseSelect(env, 'lois', {
        select: 'external_id', source: `eq.${source}`, external_id: `in.(${listeIds})`,
      });
      const idsConnus = new Set(existants.map((e: any) => e.external_id));
      const nouveaux = candidats.filter((c: any) => !idsConnus.has(c.externalId));

      if (nouveaux.length) {
        await supabaseInsert(env, 'lois', nouveaux.map((c: any) => ({
          titre: c.titre.slice(0, 300),
          description: c.description.slice(0, 5000),
          source,
          statut: statutParDefaut,
          url_source: c.lien,
          external_id: c.externalId,
        })));
        ajoutes = nouveaux.length;
      }
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

export async function synchroniserLoisJorf(env: any): Promise<ResultatSync> {
  return synchroniserFlux(
    env,
    'https://droit.org/flux/jorf.rss',
    'jorf',
    'promulguee',
    /^loi\b/i,
  );
}

// Lance les trois synchros et combine les résultats (utilisé par le cron automatique).
export async function synchroniserToutesLesLois(env: any): Promise<{ an: ResultatSync; ue: ResultatSync; jorf: ResultatSync }> {
  const [an, ue, jorf] = await Promise.all([
    synchroniserLoisAssembleeNationale(env),
    synchroniserLoisParlementEuropeen(env),
    synchroniserLoisJorf(env),
  ]);
  return { an, ue, jorf };
}

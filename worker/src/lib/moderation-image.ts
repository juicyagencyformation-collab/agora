// worker/src/lib/moderation-image.ts
// Modération automatique des photos soumises par les citoyens (Cloudflare Workers AI — modèle
// de vision Llama 3.2 11B, binding AI, voir wrangler.toml) : un filtre préventif AVANT
// publication, qui s'ajoute au schéma standard du projet (signalement → masquage immédiat →
// revue mairie, voir CLAUDE.md règle 4) sans le remplacer — un contenu limite mais passé au
// travers reste signalable normalement.
//
// Choix de Workers AI plutôt qu'un service tiers (ex. Google Vision) : zéro nouveau vendor
// (même compte Cloudflare que Worker/R2/Pages), zéro carte bancaire supplémentaire à ajouter
// nulle part, quota gratuit journalier (10 000 "neurons"/jour) largement suffisant au volume
// d'Agora. Contrepartie assumée : ce n'est pas un classifieur spécialisé/calibré comme
// SafeSearch, mais un modèle de vision généraliste prompté pour juger — probablement fiable sur
// les cas flagrants (l'essentiel du besoin), moins garanti sur les cas limites.
//
// Fail-open assumé en toute connaissance de cause : binding AI absent, modèle pas encore
// "accepté" côté compte Cloudflare (voir plus bas), quota épuisé, panne, réponse inattendue →
// on laisse toujours passer. Un faux négatif (photo limite publiée) reste rattrapable par le
// signalement citoyen existant ; un faux positif qui bloquerait l'appli entière ne l'est pas.
// La modération humaine reste le filet de sécurité final, jamais cette fonction.
//
// Réservé aux formules payantes "Accompagné" et "Premium" (argument commercial, demande
// explicite de Léandre le 2026-10-07) — une commune en "Autonomie" (ou sans formule définie)
// n'a jamais ce filtre, de façon totalement transparente (ni dégradée, ni signalée).
//
// Prérequis compte Cloudflare (une seule fois, hors code) : accepter les conditions Meta pour ce
// modèle, sinon chaque appel échoue (silencieusement laissé passer par le fail-open ci-dessous) :
//   curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct \
//     -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -d '{ "prompt": "agree" }'
import { supabaseSelect } from '../db';

const MODELE_VISION = '@cf/meta/llama-3.2-11b-vision-instruct';
const FORMULES_AVEC_MODERATION = ['accompagne', 'premium'];

const PROMPT_SYSTEME = "Tu es un modérateur de contenu pour une application municipale française grand public, utilisée par des habitants de tous âges. On te soumet une photo avant sa publication. Réponds UNIQUEMENT par un seul mot, sans aucune explication : OUI si l'image contient de la nudité, un contenu à caractère sexuel, ou de la violence graphique (sang, blessure grave, arme pointée, cadavre) — NON dans tous les autres cas, y compris les cas ambigus ou les simples doutes.";

export async function photoSuspecte(env: any, commune_id: string, donnees: ArrayBuffer, contentType: string): Promise<boolean> {
  if (!env.AI) return false;
  if (!/^image\//.test(contentType)) return false;

  try {
    const [commune] = await supabaseSelect(env, 'communes', { select: 'formule', id: `eq.${commune_id}` });
    if (!FORMULES_AVEC_MODERATION.includes(commune?.formule)) return false;

    const reponse: any = await env.AI.run(MODELE_VISION, {
      messages: [
        { role: 'system', content: PROMPT_SYSTEME },
        { role: 'user', content: 'Cette photo doit-elle être refusée ? Réponds OUI ou NON.' },
      ],
      image: `data:${contentType};base64,${arrayBufferEnBase64(donnees)}`,
      max_tokens: 5,
      temperature: 0,
    });

    const texte = String(reponse?.response ?? '').trim().toUpperCase();
    return texte.startsWith('OUI');
  } catch {
    return false;
  }
}

function arrayBufferEnBase64(buffer: ArrayBuffer): string {
  const octets = new Uint8Array(buffer);
  let binaire = '';
  for (let i = 0; i < octets.byteLength; i++) binaire += String.fromCharCode(octets[i]);
  return btoa(binaire);
}

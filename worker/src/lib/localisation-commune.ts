// worker/src/lib/localisation-commune.ts
// Département + coordonnées d'une commune, recopiés depuis sa fiche prospect au premier vrai
// usage (inscription, connexion, lien de connexion) — décidé avec Léandre le 2026-11-19.
// Les espaces préparés par la prospection d'août à octobre 2026 n'ont ni l'un ni l'autre : sans
// département, la synchro Météo-France les ignore (aucune vigilance, aucune notification) et la
// météo retombe sur une position par défaut. On ne les a rattrapés en base que pour les communes
// déjà utilisées (48) ; les autres le sont ici, le jour où quelqu'un s'en sert.
// Ne jette jamais : appelée en arrière-plan, elle ne doit pas casser une connexion.
import { supabaseSelect, supabaseUpdate } from '../db';

export async function completerLocalisationCommune(env: any, commune_id: string): Promise<void> {
  try {
    const [commune] = await supabaseSelect(env, 'communes', { select: 'departement,lat', id: `eq.${commune_id}` });
    if (!commune || commune.departement) return;
    const [prospect] = await supabaseSelect(env, 'prospects', {
      select: 'departement,lat,lng', commune_id: `eq.${commune_id}`, departement: 'not.is.null', limit: '1',
    });
    if (!prospect) return;
    const coordonnees = commune.lat == null && prospect.lat != null ? { lat: prospect.lat, lng: prospect.lng } : {};
    await supabaseUpdate(env, 'communes', { departement: prospect.departement, ...coordonnees }, {
      id: `eq.${commune_id}`, departement: 'is.null',
    });
  } catch (e) {
    console.error('Localisation commune non complétée :', e);
  }
}

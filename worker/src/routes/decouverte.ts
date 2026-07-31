// worker/src/routes/decouverte.ts
// Seule route de toute l'app qui lit délibérément à travers plusieurs communes.
// Exception strictement scopée : uniquement les communes ayant activé partage_regional,
// uniquement les événements officiels (jamais de contenu citoyen), aucune authentification
// requise (page publique, gratuite, ouverte à tous — y compris aux habitants de communes
// qui n'utilisent pas encore Agora).
import { Hono } from 'hono';
import { supabaseSelect } from '../db';
import { distanceMetres } from '../lib/geo';

const app = new Hono();

// Distance à vol d'oiseau importée depuis lib/geo.ts (voir plus haut)

app.get('/evenements', async (c) => {
  const lat = parseFloat(c.req.query('lat') || '');
  const lng = parseFloat(c.req.query('lng') || '');
  const rayonKm = Math.min(parseFloat(c.req.query('rayon') || '20'), 100);
  if (isNaN(lat) || isNaN(lng)) return c.json({ erreur: 'Position (lat, lng) requise' }, 400);

  const communes = await supabaseSelect(c.env, 'communes', {
    select: 'id,nom,slug,lat,lng,niveau_national', partage_regional: 'eq.true',
  });

  // Deux catégories bien distinctes : les communes "nationales" apparaissent toujours,
  // peu importe la distance (pas de coordonnées nécessaires) ; les communes locales sont
  // filtrées par rayon comme d'habitude.
  const communesNationales = communes
    .filter((commune: any) => commune.niveau_national)
    .map((commune: any) => ({ ...commune, distance_km: null }));

  const communesLocales = communes
    .filter((commune: any) => !commune.niveau_national && commune.lat != null && commune.lng != null)
    .map((commune: any) => ({
      ...commune,
      distance_km: Math.round(distanceMetres(lat, lng, commune.lat, commune.lng) / 1000),
    }))
    .filter((commune: any) => commune.distance_km <= rayonKm);

  const communesProches = [...communesNationales, ...communesLocales];
  if (!communesProches.length) return c.json({ evenements: [], communes_participantes: 0 });

  const idsCommunes = communesProches.map((commune: any) => commune.id);
  const evenements = await supabaseSelect(c.env, 'events', {
    select: 'id,commune_id,titre,description,lieu,lat,lng,photo_url,date_debut,date_fin',
    commune_id: `in.(${idsCommunes.join(',')})`,
    officiel: 'eq.true',
    date_fin: `gte.${new Date().toISOString()}`,
    order: 'date_debut.asc',
  });

  const result = evenements.map((e: any) => {
    const commune = communesProches.find((c: any) => c.id === e.commune_id);
    return {
      ...e,
      commune_nom: commune?.nom,
      commune_slug: commune?.slug,
      commune_distance_km: commune?.distance_km,
      commune_nationale: !!commune?.niveau_national,
    };
  });

  return c.json({ evenements: result, communes_participantes: communesProches.length });
});

export default app;

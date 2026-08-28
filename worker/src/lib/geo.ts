// worker/src/lib/geo.ts

// Déduit le code département depuis des coordonnées GPS via geo.api.gouv.fr (open data officiel,
// déjà utilisé pour la prospection — voir backoffice/prospection.ts) : gratuit, sans clé, sans
// abonnement. Retourne null si les coordonnées ne tombent sur aucune commune connue ou en cas
// d'erreur réseau — jamais bloquant, le département reste éditable à la main en repli (voir
// routes/commune.ts et lib/vigilance-meteofrance.ts).
export async function deduireDepartement(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lng}&fields=departement&format=json`);
    if (!res.ok) return null;
    const communes: any[] = await res.json();
    return communes[0]?.departement?.code ?? null;
  } catch {
    return null;
  }
}

// Distance à vol d'oiseau entre deux points GPS (formule de Haversine), en mètres.
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

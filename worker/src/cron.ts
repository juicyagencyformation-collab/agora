// worker/src/cron.ts
import { supabaseDelete, supabaseSelect } from './db';
import { deleteObject } from './storage';

export async function nettoyerCoupsDeMainExpires(env: any) {
  const seuil = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  await supabaseDelete(env, 'coups_de_main', { expires_at: `lt.${seuil}` });
}

// Purge quotidienne de "Photo du jour" — chaque commune a sa propre durée de rétention
// (1 jour / 1 semaine / 1 mois), donc on ne peut plus se contenter d'un seul jour fixe.
export async function purgerPhotosDuJour(env: any) {
  const communes = await supabaseSelect(env, 'communes', { select: 'id,photo_jour_duree' });

  for (const commune of communes) {
    const duree = commune.photo_jour_duree ?? 'semaine';
    const jours = duree === 'jour' ? 1 : duree === 'mois' ? 30 : 7;
    const seuil = new Date(Date.now() - jours * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const photos = await supabaseSelect(env, 'photos_du_jour', {
      select: 'id,r2_key', commune_id: `eq.${commune.id}`, date_publication: `lt.${seuil}`,
    });
    if (!photos.length) continue;

    await Promise.all(photos.map((p: any) => deleteObject(env, p.r2_key)));
    await supabaseDelete(env, 'photos_du_jour', { id: `in.(${photos.map((p: any) => p.id).join(',')})` });
  }
}

// Purge quotidienne de "Trouve la photo" — durée bien plus généreuse que Photo du jour
// (48h / 1 semaine / 1 mois / 6 mois / 1 an), puisqu'il faut le temps de se déplacer physiquement
// pour résoudre une énigme, contrairement à un flux social quotidien.
export async function purgerEnigmes(env: any) {
  const communes = await supabaseSelect(env, 'communes', { select: 'id,enigme_duree' });

  for (const commune of communes) {
    const duree = commune.enigme_duree ?? 'mois';
    const heures = duree === '48h' ? 48
      : duree === 'semaine' ? 24 * 7
      : duree === '6mois' ? 24 * 30 * 6
      : duree === 'an' ? 24 * 365
      : 24 * 30; // 'mois' par défaut
    const seuil = new Date(Date.now() - heures * 3600 * 1000).toISOString();

    const enigmes = await supabaseSelect(env, 'photos_enigmes', {
      select: 'id,r2_key', commune_id: `eq.${commune.id}`, created_at: `lt.${seuil}`,
    });
    if (!enigmes.length) continue;

    await Promise.all(enigmes.map((e: any) => deleteObject(env, e.r2_key)));
    await supabaseDelete(env, 'photos_enigmes', { id: `in.(${enigmes.map((e: any) => e.id).join(',')})` });
  }
}

// Purge quotidienne du Mur des voisins — messages éphémères (24h ou 48h selon la commune).
// Les messages n'ont pas de photo (module simplifié), pas de nettoyage R2 nécessaire.
export async function purgerMur(env: any) {
  const communes = await supabaseSelect(env, 'communes', { select: 'id,mur_duree' });

  for (const commune of communes) {
    const duree = commune.mur_duree ?? '48h';
    const heures = duree === '24h' ? 24 : 48;
    const seuil = new Date(Date.now() - heures * 3600 * 1000).toISOString();

    const posts = await supabaseSelect(env, 'posts', {
      select: 'id', commune_id: `eq.${commune.id}`, created_at: `lt.${seuil}`,
    });
    if (!posts.length) continue;

    await supabaseDelete(env, 'posts', { id: `in.(${posts.map((p: any) => p.id).join(',')})` });
  }
}


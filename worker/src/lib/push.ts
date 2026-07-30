// worker/src/lib/push.ts
import { buildPushHTTPRequest } from '@pushforge/builder';
import { supabaseSelect, supabaseDelete } from '../db';

// Envoie une notification push à une liste d'utilisateurs (tous appareils confondus).
// Échoue silencieusement par abonné — un envoi raté ne doit jamais faire échouer la
// création de contenu qui l'a déclenché. Les abonnements expirés (404/410) sont nettoyés.
export async function envoyerNotificationAUtilisateurs(
  env: any, commune_id: string, userIds: string[], titre: string, corps: string, url: string,
) {
  if (!userIds.length) return;

  const subs = await supabaseSelect(env, 'push_subscriptions', {
    select: 'id,endpoint,p256dh,auth',
    commune_id: `eq.${commune_id}`,
    user_id: `in.(${userIds.join(',')})`,
  });
  if (!subs.length) return;

  await Promise.all(subs.map(async (s: any) => {
    try {
      const { endpoint, headers, body } = await buildPushHTTPRequest({
        privateJWK: JSON.parse(env.VAPID_PRIVATE_KEY),
        subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message: {
          payload: { title: titre, body: corps, url },
          adminContact: 'mailto:contact@plateforme-agora.fr',
          options: { ttl: 86400, urgency: 'normal' },
        },
      });
      const res = await fetch(endpoint, { method: 'POST', headers, body });
      if (res.status === 404 || res.status === 410) {
        // Abonnement mort (désinstallation, permission révoquée...) : on le retire.
        await supabaseDelete(env, 'push_subscriptions', { id: `eq.${s.id}` });
      }
    } catch {
      // Échec réseau isolé pour cet abonné : on continue avec les autres, sans jamais
      // faire remonter d'erreur vers la route appelante (création d'article/chasse/énigme).
    }
  }));
}

// Récupère les user_id des citoyens de la commune ayant activé une catégorie de notification.
export async function utilisateursAbonnesA(env: any, commune_id: string, colonnePreference: string): Promise<string[]> {
  const users = await supabaseSelect(env, 'users', {
    select: 'id', commune_id: `eq.${commune_id}`, [colonnePreference]: 'eq.true',
  });
  return users.map((u: any) => u.id);
}

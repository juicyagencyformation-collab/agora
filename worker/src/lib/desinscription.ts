// worker/src/lib/desinscription.ts
// Désinscription des emails « de suivi » (2026-11-05, après le retrait de plateforme-agora.fr de
// la liste noire Spamhaus — engagement pris : un lien de désinscription dans tout message non
// transactionnel). Concerne : relances d'onboarding, bilan mensuel, bienvenue/relance de commune,
// présentation et email libre de prospection. JAMAIS les emails de service (lien de connexion,
// mot de passe oublié, accès, convention, échéance) : la personne en a besoin.
//
// Deux voies, même effet :
// - un lien en bas de l'email → page de confirmation avec un bouton (jamais d'effet sur le simple
//   chargement : les antivirus des mairies visitent les liens d'un email avant l'humain) ;
// - les en-têtes List-Unsubscribe + List-Unsubscribe-Post (RFC 8058) → bouton « Se désabonner »
//   intégré de Gmail/Outlook/Yahoo, qui fait un POST direct (exigé de Gmail/Yahoo depuis 2024).
// Le lien porte une signature HMAC de l'adresse : impossible de désinscrire quelqu'un d'autre.
import { supabaseSelect, supabaseUpsert } from '../db';
import { envoyerEmail } from './email';

export function normaliserEmail(email: string): string {
  return email.trim().toLowerCase();
}

// HMAC-SHA256(adresse) avec une clé dérivée du secret JWT (préfixe dédié : une signature de
// désinscription ne peut servir à rien d'autre). 32 caractères hexadécimaux suffisent ici.
export async function signatureDesinscription(env: any, email: string): Promise<string> {
  const cle = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(`desinscription:${env.JWT_SECRET}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(normaliserEmail(email)));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function signatureValide(env: any, email: string, signature: string): Promise<boolean> {
  if (!email || !/^[a-f0-9]{32}$/.test(signature || '')) return false;
  const attendue = await signatureDesinscription(env, email);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= attendue.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export async function lienDesinscription(env: any, email: string): Promise<string> {
  const e = normaliserEmail(email);
  return `${env.FRONTEND_URL}/api/desinscription?e=${encodeURIComponent(e)}&s=${await signatureDesinscription(env, e)}`;
}

// Si la table manque (migration non passée) ou si Supabase répond mal, l'adresse est considérée
// comme inscrite : sinon plus aucun email de suivi ne partirait. Le risque inverse (écrire à une
// adresse désinscrite) est borné à la durée de la panne.
export async function adresseDesinscrite(env: any, email: string): Promise<boolean> {
  try {
    const [ligne] = await supabaseSelect(env, 'desinscriptions_email', { select: 'id', email: `eq.${normaliserEmail(email)}`, limit: '1' });
    return !!ligne;
  } catch {
    return false;
  }
}

export async function enregistrerDesinscription(env: any, email: string, source: 'lien' | 'messagerie'): Promise<void> {
  const e = normaliserEmail(email);
  const [commune] = await supabaseSelect(env, 'communes', {
    select: 'id', or: `(contact_email.eq.${e},email_mairie.eq.${e})`, limit: '1',
  }).catch(() => []);
  await supabaseUpsert(env, 'desinscriptions_email', [{ email: e, source, commune_id: commune?.id ?? null }], 'email');
}

function piedDesinscription(lien: string): string {
  return `<p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;line-height:1.5;color:#8a8f98;text-align:center;margin:28px auto 8px;max-width:560px">`
    + `Vous recevez cet email de suivi de la part de Plateforme-Agora.<br>`
    + `<a href="${lien}" style="color:#8a8f98;text-decoration:underline">Ne plus recevoir ces emails</a></p>`;
}

// Remplace envoyerEmail pour tout email de suivi : ne part pas vers une adresse désinscrite (renvoie
// null, comme un échec), ajoute le lien en bas et les en-têtes de désinscription des messageries.
export async function envoyerEmailSuivi(
  env: any, to: string, subject: string, html: string, attachments?: any[], replyTo?: string,
  headersPersonnalises?: Record<string, string>,
): Promise<string | null> {
  if (await adresseDesinscrite(env, to)) {
    console.log(`Email de suivi non envoyé : ${normaliserEmail(to)} est désinscrite.`);
    return null;
  }
  const lien = await lienDesinscription(env, to);
  const pied = piedDesinscription(lien);
  const corps = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${pied}</body>`) : html + pied;
  return envoyerEmail(env, to, subject, corps, attachments, replyTo, {
    ...(headersPersonnalises || {}),
    'List-Unsubscribe': `<${lien}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
}

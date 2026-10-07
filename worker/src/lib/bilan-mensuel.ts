// worker/src/lib/bilan-mensuel.ts
// Bilan mensuel automatique envoyé par email au maire — argument de vente de la formule
// "Accompagné"/"Premium" (communes.formule) : un rapport d'activité livré sans que le maire ait
// à se connecter, décidé le 2026-10-07 en remplacement de l'idée initiale de sondage hebdo
// (jugée trop lourde à alimenter en contenu pertinent, voir le fil de discussion avec Léandre).
// Pur reporting de données déjà existantes — zéro génération de contenu, donc zéro risque de
// texte hors-sujet ou inventé.
import { supabaseCount, supabaseSelect } from '../db';
import { envoyerEmail } from '../lib/email';

const FORMULES_AVEC_BILAN = ['accompagne', 'premium'];

function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}

export type BilanMensuel = {
  nouveauxSignalements: number;
  signalementsEnAttente: number;
  nouvellesActus: number;
  nouveauxHabitants: number;
};

export async function calculerBilanMensuel(env: any, commune_id: string, debut: Date, fin: Date): Promise<BilanMensuel> {
  // PostgREST ne permet pas deux filtres sur la même colonne dans un objet JS classique (clés
  // dupliquées) — on passe par le paramètre and=(...) pour borner created_at des deux côtés
  // (mois écoulé complet, pas tout ce qui a suivi `debut`).
  const periode = { and: `(created_at.gte.${debut.toISOString()},created_at.lt.${fin.toISOString()})` };

  const [nouveauxSignalements, signalementsEnAttente, nouvellesActus, nouveauxHabitants] = await Promise.all([
    supabaseCount(env, 'alertes', { commune_id: `eq.${commune_id}`, ...periode }),
    // Pas borné dans le temps, volontairement : on veut TOUT ce qui traîne encore aujourd'hui,
    // pas seulement ce qui date du mois écoulé — c'est ça qui pousse la mairie à agir.
    supabaseCount(env, 'alertes', { commune_id: `eq.${commune_id}`, statut: 'in.(ouverte,en_cours)' }),
    supabaseCount(env, 'articles', { commune_id: `eq.${commune_id}`, section: 'eq.actualites', ...periode }),
    supabaseCount(env, 'users', { commune_id: `eq.${commune_id}`, role: 'eq.citoyen', ...periode }),
  ]);

  return { nouveauxSignalements, signalementsEnAttente, nouvellesActus, nouveauxHabitants };
}

function nomMois(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
}

export function bilanMensuelHtml(nomCommune: string, periode: Date, b: BilanMensuel, frontendUrl: string, slug: string): string {
  const nom = echapper(nomCommune);
  const ligne = (emoji: string, valeur: number, libelle: string) => `
    <tr>
      <td style="padding:10px 0;font-size:28px;width:50px">${emoji}</td>
      <td style="padding:10px 0">
        <div style="font-size:20px;font-weight:700;color:#1b2a1c">${valeur}</div>
        <div style="font-size:13px;color:#5b6b5c">${libelle}</div>
      </td>
    </tr>`;

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">Bilan mensuel de ${nom}</div>

    <h1 style="font-size:20px;line-height:1.3">Votre commune en ${nomMois(periode)}</h1>
    <p style="font-size:14px;color:#3a4a3b;line-height:1.6">
      Un résumé automatique de l'activité de votre application, pour que vous n'ayez rien à vérifier vous-même.
    </p>

    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      ${ligne('🚨', b.nouveauxSignalements, `nouveau${b.nouveauxSignalements > 1 ? 'x' : ''} signalement${b.nouveauxSignalements > 1 ? 's' : ''} ce mois-ci`)}
      ${ligne('⏳', b.signalementsEnAttente, `signalement${b.signalementsEnAttente > 1 ? 's' : ''} encore en attente de réponse`)}
      ${ligne('📰', b.nouvellesActus, `actualité${b.nouvellesActus > 1 ? 's' : ''} publiée${b.nouvellesActus > 1 ? 's' : ''} ce mois-ci`)}
      ${ligne('👋', b.nouveauxHabitants, `nouvel${b.nouveauxHabitants > 1 ? 'les' : ''} habitant${b.nouveauxHabitants > 1 ? 's' : ''} inscrit${b.nouveauxHabitants > 1 ? 's' : ''}`)}
    </table>

    ${b.signalementsEnAttente > 0 ? `
    <div style="background:#fdf4f0;border:1px solid #f0d9ce;border-radius:10px;padding:14px 18px;margin:20px 0;font-size:13.5px;color:#7a4a2e">
      💡 ${b.signalementsEnAttente > 1 ? `${b.signalementsEnAttente} signalements attendent` : 'Un signalement attend'} une réponse de la mairie — vos habitants verront que vous les avez lus dès que vous y répondrez.
    </div>` : ''}

    <p style="margin:24px 0">
      <a href="${frontendUrl}/${slug}/" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Ouvrir mon application</a>
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c">
      Juicy Solutions — Léandre Sallé · plateforme-agora.fr<br />
      Ce bilan mensuel fait partie de votre formule Accompagné/Premium. Une question&nbsp;? Répondez simplement à cet email.
    </div>
  </div>`;
}

// Envoi mensuel — branché sur le cron du 1er du mois à 3h (voir worker/src/index.ts). Réservé
// aux formules "accompagne"/"premium" (même logique que la modération photo, voir
// lib/moderation-image.ts) : l'argument de vente ne vaut que pour ceux qui le paient.
export async function envoyerBilansMensuels(env: any): Promise<void> {
  const communes = await supabaseSelect(env, 'communes', {
    select: 'id,nom,slug,contact_email,email_mairie,formule',
    formule: `in.(${FORMULES_AVEC_BILAN.join(',')})`,
  });

  const maintenant = new Date();
  // Mois CALENDAIRE précédent (ex. envoyé le 1er novembre à 3h -> bilan d'octobre), pas les 30
  // derniers jours glissants : plus naturel à lire ("votre bilan d'octobre") qu'une fenêtre floue.
  const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1, 1));
  const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));

  for (const commune of communes) {
    const destinataire = commune.contact_email || commune.email_mairie;
    if (!destinataire) continue;

    try {
      const bilan = await calculerBilanMensuel(env, commune.id, debut, fin);
      const html = bilanMensuelHtml(commune.nom, debut, bilan, env.FRONTEND_URL, commune.slug);
      await envoyerEmail(env, destinataire, `📊 Le bilan de ${commune.nom} — ${nomMois(debut)}`, html);
    } catch (err) {
      // Une commune en échec (email invalide, panne ponctuelle...) ne doit jamais empêcher
      // l'envoi aux autres communes de la boucle.
      console.error(`Bilan mensuel échoué pour ${commune.slug} :`, err);
    }
  }
}

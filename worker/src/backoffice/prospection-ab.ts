// worker/src/backoffice/prospection-ab.ts
// Gestion automatique des variantes A/B de l'email de présentation (cle='presentation' dans
// modeles_email) — décidé avec Léandre le 2026-08-25, après une lecture manuelle de l'entonnoir
// où une variante ("A/2") ressortait à 31% de rejet. Contrairement au principe affiché dans
// administration.ts ("on ne bascule jamais l'envoi automatiquement, l'activation est un choix
// explicite"), cette fonction EST une exception délibérée et documentée à cette règle : appelée
// depuis le cron quotidien (voir cron.ts), elle peut basculer la variante active toute seule.
// Toute bascule est journalisée (journal_activite, staff_id=null car aucun humain n'a agi) et
// signalée par email à Léandre — jamais silencieuse.
import { supabaseSelect, supabaseUpdate, journaliser } from '../db';
import { envoyerEmail } from '../lib/email';
import { calculerStatsVariantes, type StatVariante } from './prospection';

// Seuils choisis à la main le 2026-08-25 à partir des premiers chiffres réels observés
// (campagnes de 800 à 3000 envois, rejets normaux entre 9% et 18%, 31% jugé clairement anormal
// pour "A/2"). Pas encore éditables depuis le backoffice : à revoir une fois éprouvés en pratique
// sur plusieurs cycles, si les valeurs ci-dessous s'avèrent mal calibrées.
const SEUIL_VOLUME_DANGER = 50;        // envois minimum avant de juger le taux de rejet de la variante active
const SEUIL_REJET_DANGER = 0.25;       // 25% de rejet déclenche une bascule d'urgence
const SEUIL_VOLUME_ALTERNATIVE = 30;   // envois minimum pour qu'une autre variante soit une bascule "sûre"
const SEUIL_VOLUME_MATURE = 100;       // envois matures (≥7j) minimum pour juger une variante sur la durée
const SEUIL_ECART_PROMOTION = 8;       // points de taux d'ouverture mature d'avance nécessaires pour promouvoir un gagnant

async function activerVariante(env: any, id: string): Promise<void> {
  await supabaseUpdate(env, 'modeles_email', { actif: false }, { cle: 'eq.presentation', actif: 'eq.true' });
  await supabaseUpdate(env, 'modeles_email', { actif: true }, { id: `eq.${id}` });
}

function pctRejet(v: StatVariante): number {
  return v.envoyes ? v.rejetes / v.envoyes : 0;
}

async function alerterLeandre(env: any, sujet: string, texteHtml: string): Promise<void> {
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:22px;font-weight:800;color:#2c5f2d">Agora — Prospection</div>
    <div style="color:#5b6b5c;font-size:13px;margin-bottom:18px">Vérification automatique quotidienne des variantes A/B</div>
    ${texteHtml}
    <p style="font-size:12.5px;color:#8a8a8a;margin-top:24px">
      Voir l'entonnoir complet : /backoffice/ → Prospection → « Entonnoir de prospection ».
    </p>
  </div>`;
  await envoyerEmail(env, 'contact@plateforme-agora.fr', sujet, html);
}

// Appelée une fois par jour (cron.ts). Ne fait AU PLUS une action par passage : soit une bascule
// d'urgence, soit une promotion de gagnant, jamais les deux — pour rester lisible dans le journal
// et laisser le temps d'observer l'effet d'un changement avant le suivant.
export async function gererVariantesProspectionAutomatiquement(env: any): Promise<void> {
  const variantes = await calculerStatsVariantes(env);
  if (variantes.length < 2) return; // rien à comparer

  const lignesModeles = await supabaseSelect(env, 'modeles_email', {
    select: 'id,nom,actif', cle: 'eq.presentation',
  });
  const idParNom = new Map(lignesModeles.map((m: any) => [m.nom, m.id]));
  const active = lignesModeles.find((m: any) => m.actif);
  if (!active) return; // rien d'actif — ne devrait pas arriver, on ne force rien dans ce cas

  const statActive = variantes.find((v) => v.nom === active.nom);

  // 1) Bascule d'urgence : la variante active bounce trop, on protège la réputation d'envoi.
  if (statActive && statActive.envoyes >= SEUIL_VOLUME_DANGER && pctRejet(statActive) > SEUIL_REJET_DANGER) {
    const alternative = variantes
      .filter((v) => v.nom !== active.nom && v.envoyes >= SEUIL_VOLUME_ALTERNATIVE && pctRejet(v) <= SEUIL_REJET_DANGER)
      .sort((a, b) => (b.taux_ouverture_mature ?? (b.ouverts / b.envoyes)) - (a.taux_ouverture_mature ?? (a.ouverts / a.envoyes)))[0];

    const tauxActif = Math.round(pctRejet(statActive) * 1000) / 10;

    if (alternative && idParNom.has(alternative.nom)) {
      await activerVariante(env, idParNom.get(alternative.nom)!);
      await journaliser(env, null, 'variante_prospection_basculee_urgence',
        `${active.nom} (${tauxActif}% rejet, ${statActive.envoyes} envois) → ${alternative.nom}`);
      await alerterLeandre(env, `⚠️ Variante de prospection changée automatiquement (rejet ${tauxActif}%)`, `
        <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
          <strong>${active.nom}</strong> a atteint <strong>${tauxActif}% de rejet</strong>
          sur ${statActive.envoyes} envois — au-delà du seuil de ${Math.round(SEUIL_REJET_DANGER * 100)}%.
        </p>
        <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
          Bascule automatique vers <strong>${alternative.nom}</strong>
          (${Math.round(pctRejet(alternative) * 1000) / 10}% de rejet sur ${alternative.envoyes} envois)
          pour les prochains envois.
        </p>`);
    } else {
      await alerterLeandre(env, `🚨 Prospection à surveiller — ${active.nom} à ${tauxActif}% de rejet, aucune alternative sûre`, `
        <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
          <strong>${active.nom}</strong> a atteint <strong>${tauxActif}% de rejet</strong>
          sur ${statActive.envoyes} envois, mais aucune autre variante n'a assez de volume
          (≥ ${SEUIL_VOLUME_ALTERNATIVE} envois) avec un rejet sous ${Math.round(SEUIL_REJET_DANGER * 100)}%
          pour basculer dessus en confiance. Aucun changement automatique — à vérifier à la main.
        </p>`);
    }
    return;
  }

  // 2) Promotion du gagnant : pas d'urgence, mais une variante mature bat clairement l'actuelle.
  if (!statActive || statActive.envoyes_matures < SEUIL_VOLUME_MATURE) return;
  const meilleure = variantes
    .filter((v) => v.envoyes_matures >= SEUIL_VOLUME_MATURE && pctRejet(v) <= SEUIL_REJET_DANGER)
    .sort((a, b) => (b.taux_ouverture_mature ?? 0) - (a.taux_ouverture_mature ?? 0))[0];
  if (!meilleure || meilleure.nom === active.nom) return;

  const ecart = (meilleure.taux_ouverture_mature ?? 0) - (statActive.taux_ouverture_mature ?? 0);
  if (ecart < SEUIL_ECART_PROMOTION) return;

  const id = idParNom.get(meilleure.nom);
  if (!id) return;
  await activerVariante(env, id);
  await journaliser(env, null, 'variante_prospection_promue',
    `${meilleure.nom} (${meilleure.taux_ouverture_mature}% ouverture mature) devient active, devant ${active.nom} (${statActive.taux_ouverture_mature}%)`);
  await alerterLeandre(env, `✅ Nouvelle variante de prospection promue automatiquement : ${meilleure.nom}`, `
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      <strong>${meilleure.nom}</strong> a un taux d'ouverture mature (≥7j) de
      <strong>${meilleure.taux_ouverture_mature}%</strong> sur ${meilleure.envoyes_matures} envois matures,
      contre ${statActive.taux_ouverture_mature}% pour <strong>${active.nom}</strong>
      (écart de ${Math.round(ecart * 10) / 10} points ≥ seuil de ${SEUIL_ECART_PROMOTION}).
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Elle devient la variante active pour les prochains envois.
    </p>`);
}

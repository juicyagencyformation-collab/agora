// worker/src/lib/formule-commune.ts
// Volet « Votre formule » de Ma commune (2026-11-18, migration 105, maquette
// https://claude.ai/artifact/38TEWSi4pkYLd9RWE69i5E) : formule actuelle de la commune, onglets
// inclus et verrouillés, prix calculé au barème du site, et demande de changement de formule.
// Rien ne s'active d'ici : la demande part par email à l'équipe et apparaît dans le backoffice
// (backoffice/suivi-communes.ts, GET /anomalies) ; la formule est activée à la main ensuite.
// Prix et textes des offres : MÊMES sources que la page d'accueil du site (barème et textes
// enregistrés dans le backoffice, voir backoffice/tarification.ts), pour que tout colle.
import { z } from 'zod';
import { supabaseSelect } from '../db';
import { chargerBareme, calculerPrixAutonomie, calculerPrixAccompagne, estSurDevis, chargerOffresTexte, structurerOffresTexte } from '../backoffice/tarification';
import { TOUS_LES_ONGLETS } from '../backoffice/administration';

// Une demande en attente depuis plus longtemps n'est plus « en cours » : la mairie peut redemander.
export const JOURS_VALIDITE_DEMANDE = 30;
export const ROLES_DEMANDE_FORMULE = ['elu', 'maire', 'superadmin'];

export const FORMULES_SOUHAITEES = { autonomie: 'Autonomie', accompagne: 'Accompagné', conseil: 'Ne sait pas encore, à conseiller' } as const;

export const demandeFormuleSchema = z.object({
  formule_souhaitee: z.enum(Object.keys(FORMULES_SOUHAITEES) as [keyof typeof FORMULES_SOUHAITEES]),
  telephone: z.string().trim().min(6).max(30).regex(/^[0-9+().\s-]+$/, 'Téléphone invalide'),
  message: z.string().trim().max(1000).optional().default(''),
});

export type FormuleActuelle = 'gratuite' | 'autonomie' | 'accompagne' | 'premium' | 'fondateur' | 'complete';

// Formule affichée à la mairie. La formule enregistrée dans le backoffice prime ; sinon le
// palier : fondateur, tout ouvert (version complète) ou gratuit (au moins un onglet verrouillé).
export function formuleActuelle(commune: { formule?: string | null; forfait?: string | null }, nbOngletsVerrouilles: number): FormuleActuelle {
  if (commune.formule === 'autonomie' || commune.formule === 'accompagne' || commune.formule === 'premium') return commune.formule;
  // Fondatrice en formule gratuite (convention, migration 120) : peut demander à passer au payant.
  if (commune.formule === 'gratuit') return 'gratuite';
  if (commune.forfait === 'Fondateur') return 'fondateur';
  return nbOngletsVerrouilles > 0 ? 'gratuite' : 'complete';
}

// Une demande « en cours » : en attente, et de moins de JOURS_VALIDITE_DEMANDE jours.
export function demandeEnCours(demandes: { statut: string; created_at: string }[], maintenant = Date.now()) {
  const limite = maintenant - JOURS_VALIDITE_DEMANDE * 86400000;
  return demandes.find((d) => d.statut === 'en_attente' && new Date(d.created_at).getTime() >= limite) ?? null;
}

export async function infosFormule(env: any, commune_id: string, role: string) {
  const [[commune], onglets, demandes, bareme, textes] = await Promise.all([
    supabaseSelect(env, 'communes', { select: 'nom,population,formule,forfait,telephone_mairie', id: `eq.${commune_id}` }),
    supabaseSelect(env, 'onglets_config', { select: 'cle,actif', commune_id: `eq.${commune_id}` }),
    supabaseSelect(env, 'demandes_formule', {
      select: 'formule_souhaitee,statut,created_at', commune_id: `eq.${commune_id}`, statut: 'eq.en_attente', order: 'created_at.desc',
    }).catch(() => [] as any[]),
    chargerBareme(env),
    chargerOffresTexte(env),
  ]);
  // Un onglet sans ligne en base est actif (même règle que GET /moderation/onglets).
  const presents = new Set(onglets.map((o: any) => o.cle));
  const ongletsUtiles = [...onglets, ...TOUS_LES_ONGLETS.filter((cle) => !presents.has(cle)).map((cle) => ({ cle, actif: true }))]
    .filter((o: any) => o.cle !== 'profil');
  const verrouilles = ongletsUtiles.filter((o: any) => !o.actif).map((o: any) => o.cle);
  const formule = formuleActuelle(commune ?? {}, verrouilles.length);
  const population = commune?.population ?? null;
  const enCours = demandeEnCours(demandes);
  const offres = structurerOffresTexte(textes);
  return {
    formule,
    onglets_inclus: ongletsUtiles.filter((o: any) => o.actif).map((o: any) => o.cle),
    onglets_verrouilles: verrouilles,
    population,
    // Au-delà du seuil du barème : le volet affiche « sur devis » au lieu des prix calculés.
    sur_devis: estSurDevis(population, bareme),
    prix_annuels: {
      autonomie: calculerPrixAutonomie(population ?? 0, bareme),
      accompagne: calculerPrixAccompagne(population ?? 0, bareme),
    },
    offres: { autonomie: offres.autonomie, accompagne: offres.accompagne },
    telephone_mairie: commune?.telephone_mairie ?? '',
    demande_en_cours: enCours ? { formule_souhaitee: enCours.formule_souhaitee, created_at: enCours.created_at } : null,
    // Gratuite → Autonomie ou Accompagné ; Autonomie → Accompagné. Seuls le maire et les élus
    // décident : un admin voit le volet, sans le bouton.
    peut_demander: ROLES_DEMANDE_FORMULE.includes(role) && (formule === 'gratuite' || formule === 'autonomie') && !enCours,
  };
}

const echapper = (s: string) => s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string));

export function emailDemandeFormule(d: {
  commune: string; population: number | null; formule_actuelle: string; formule_souhaitee: keyof typeof FORMULES_SOUHAITEES;
  demandeur: string; role: string; email: string; telephone: string; message: string;
}) {
  const sujet = `Demande de formule : ${d.commune} → ${FORMULES_SOUHAITEES[d.formule_souhaitee]}`;
  const ligne = (libelle: string, valeur: string) => `<tr><td style="padding:4px 12px 4px 0;color:#8B7355">${libelle}</td><td style="padding:4px 0"><b>${echapper(valeur)}</b></td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#3D3530">
    <p>Une mairie demande à changer de formule depuis l'application (à rappeler sous 48 h ouvrées).</p>
    <table style="border-collapse:collapse">
      ${ligne('Commune', d.commune)}
      ${ligne('Habitants', d.population ? d.population.toLocaleString('fr-FR') : 'non renseigné')}
      ${ligne('Formule actuelle', d.formule_actuelle)}
      ${ligne('Formule souhaitée', FORMULES_SOUHAITEES[d.formule_souhaitee])}
      ${ligne('Demandeur', `${d.demandeur} (${d.role})`)}
      ${ligne('Email', d.email)}
      ${ligne('Téléphone', d.telephone)}
    </table>
    ${d.message ? `<p style="margin-top:12px"><b>Message :</b><br>${echapper(d.message).replace(/\n/g, '<br>')}</p>` : ''}
    <p style="color:#8B7355;font-size:12px">La demande apparaît aussi dans le backoffice (Aujourd'hui → Anomalies à corriger). Elle disparaît quand la formule ou le palier de la commune change.</p>
  </div>`;
  return { sujet, html };
}

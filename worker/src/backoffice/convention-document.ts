// worker/src/backoffice/convention-document.ts
// Convention « Commune fondatrice », pré-remplie pour une commune (voir backoffice/conventions.ts).
// Texte de référence : celui rédigé et relu par Léandre le 2026-10-26 (Claude Docs), repris tel
// quel — seuls les blancs sont remplis depuis la fiche commune, les informations réunies auprès de
// la mairie et les paramètres de l'entreprise. Tout changement de fond du texte se fait ICI.
// Chaque valeur vient de la mairie ou de la base : TOUJOURS échappée.
import { NOMS_DEPARTEMENTS } from '../lib/regions';

function echapper(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}
const A_COMPLETER = (libelle = '……………') => `<span class="a-completer">${libelle}</span>`;
const ou = (v: unknown, libelle?: string) => (v === null || v === undefined || String(v).trim() === '' ? A_COMPLETER(libelle) : echapper(v));
const dateFr = (iso: string | null | undefined) =>
  iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

export type DonneesConvention = {
  numero_fondatrice: number | null;
  signataire_nom: string | null;
  signataire_qualite: string | null;
  deliberation_reference: string | null;
  deliberation_date: string | null;
  option_reconduction: 'tacite' | 'annuelle' | null;
  siret_commune: string | null;
  code_service_chorus: string | null;
  facturation_nom: string | null;
  facturation_email: string | null;
  date_debut_souhaitee: string | null;
  citation_autorisee: boolean | null;
};

export function genererConventionHtml(
  conv: DonneesConvention,
  commune: { nom: string; slug: string },
  departement: string | null,
  entreprise: Record<string, string>,
): string {
  const nomCommune = echapper(commune.nom);
  const lieuCommune = departement ? ` (${echapper(NOMS_DEPARTEMENTS[departement] ?? '')}${NOMS_DEPARTEMENTS[departement] ? ', ' : ''}${echapper(departement)})` : '';
  const siren = (entreprise.entreprise_siret || '').replace(/\s/g, '').slice(0, 9);
  const sirenFormate = siren.length === 9 ? `${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}` : '';
  const qualite = conv.signataire_qualite?.trim() || 'maire';
  const tacite = conv.option_reconduction === 'tacite';
  const annuelle = conv.option_reconduction === 'annuelle';

  const dureeAbonnement = tacite
    ? "L'abonnement est conclu pour 1 an, reconductible tacitement 3 fois, soit 4 ans au maximum. Au terme de ces 4 ans, un nouveau contrat signé dans la continuité conserve la réduction."
    : annuelle
      ? "L'abonnement est conclu pour 1 an, renouvelable chaque année par décision expresse de la Commune (bon de commande ou délibération). Chaque renouvellement conserve la réduction."
      : `L'abonnement est conclu pour 1 an, ${A_COMPLETER('[reconductible tacitement 3 fois, soit 4 ans au maximum — OU — renouvelable chaque année par décision expresse de la Commune]')}.`;
  const preavis = annuelle
    ? "<p><strong>Échéance</strong> — sans nouvelle décision de la Commune, l'abonnement prend fin à sa date anniversaire, sans démarche particulière.</p>"
    : '<p><strong>Préavis</strong> — la Commune peut refuser la reconduction par mail, au moins 2 mois avant la date anniversaire de l\'abonnement.</p>';
  const dureeTableau = tacite ? '1 an, reconductible tacitement 3 fois' : annuelle ? '1 an, renouvelable chaque année sur décision de la Commune' : A_COMPLETER('[selon l\'option choisie]');
  const case_ = (coche: boolean) => (coche ? '☒' : '☐');
  const citation = conv.citation_autorisee === null || conv.citation_autorisee === undefined
    ? `☐ oui ☐ non ${A_COMPLETER('[à cocher]')}`
    : `${case_(conv.citation_autorisee)} oui ${case_(!conv.citation_autorisee)} non`;
  const contactFacturation = conv.facturation_nom || conv.facturation_email
    ? `${echapper(conv.facturation_nom ?? '')}${conv.facturation_nom && conv.facturation_email ? ', ' : ''}${echapper(conv.facturation_email ?? '')}`
    : A_COMPLETER();

  return `
    <style>
      .contrat h1 { font-size: 20px; color: var(--navy); text-align: center; margin-bottom: 4px; }
      .contrat .sous-titre { text-align: center; font-size: 13px; color: var(--gris); margin-bottom: 4px; }
      .contrat .chapeau { font-size: 12.5px; line-height: 1.6; margin: 18px 0; padding: 10px 14px; background: var(--fond-doux); border-radius: 8px; }
      .contrat h2 { font-size: 14.5px; color: var(--navy); margin: 22px 0 8px; border-bottom: 1px solid var(--bord); padding-bottom: 4px; }
      .contrat p { font-size: 12.5px; line-height: 1.65; margin-bottom: 8px; text-align: justify; }
      .contrat ol, .contrat ul { font-size: 12.5px; line-height: 1.65; margin: 6px 0 10px 20px; }
      .contrat table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 11.5px; }
      .contrat table, .contrat th, .contrat td { border: 1px solid var(--bord); }
      .contrat th, .contrat td { padding: 6px 8px; text-align: left; vertical-align: top; }
      .contrat th { background: var(--fond-doux); }
      .a-completer { color: #b45309; font-weight: 600; }
      .contrat .signatures { display: flex; gap: 24px; margin-top: 30px; }
      .contrat .signatures > div { flex: 1; border: 1px dashed var(--bord); border-radius: 10px; padding: 14px 16px; text-align: center; font-size: 12px; color: var(--gris); }
      .contrat .signatures b { display: block; font-size: 13px; color: var(--encre); margin-bottom: 40px; }
    </style>

    <div class="contrat">
      <h1>Convention « Commune fondatrice » — ${nomCommune}</h1>
      <div class="sous-titre">Plateforme-Agora</div>
      <p class="chapeau">La commune de ${nomCommune} devient commune fondatrice de Plateforme-Agora : accès complet à tous les onglets pour 1 € symbolique pendant 12 mois, puis 35 % de réduction garantis tant que son abonnement se poursuit sans interruption, en échange de ses retours d'expérience.</p>

      <h2>Article 1 — Les parties</h2>
      <p><strong>Le prestataire</strong> — Léandre SALLE, ${echapper((entreprise.entreprise_forme_juridique || 'entrepreneur individuel').toLowerCase())} (« ${ou(entreprise.entreprise_raison_sociale)} »), éditeur de Plateforme-Agora. Siège : ${ou(entreprise.entreprise_adresse)}, ${ou(entreprise.entreprise_cp_ville)} — SIREN ${ou(sirenFormate)}, RCS Amiens. Contact : ${ou(entreprise.entreprise_email)}. Ci-après « le Prestataire ».</p>
      <p><strong>La commune bénéficiaire</strong> — Commune de ${nomCommune}${lieuCommune}, SIRET ${ou(conv.siret_commune)}, représentée par ${ou(conv.signataire_nom, 'M. / Mme ……………')}, ${echapper(qualite)}, agissant en vertu de la délibération n° ${ou(conv.deliberation_reference)} du ${ou(dateFr(conv.deliberation_date))}. Ci-après « la Commune ».</p>

      <h2>Article 2 — Objet et statut de commune fondatrice</h2>
      <p>La convention met à disposition de la Commune un espace Plateforme-Agora complet et lui confère le statut de <strong>Commune fondatrice</strong>.</p>
      <p>Ce statut est réservé aux 10 premières communes signataires. La Commune est la commune fondatrice n° ${ou(conv.numero_fondatrice)} / 10.</p>
      <p>Il comprend :</p>
      <ul>
        <li><strong>Tous les onglets et modules</strong> disponibles à la mise en service : actualités, agenda, alertes météo et vigilance, Conseil municipal, sondages, annuaire, mur des voisins et entraide, carte du village, chasse au trésor patrimoine, ainsi que les modules ajoutés pendant la période fondatrice.</li>
        <li><strong>Un espace dédié</strong> à l'adresse plateforme-agora.fr/${echapper(commune.slug)}, administré par la mairie.</li>
        <li><strong>Un accès prioritaire au Prestataire</strong> pour le support et la prise en compte des demandes d'évolution.</li>
        <li><strong>La mention « Commune fondatrice »</strong> dans l'application, si la Commune le souhaite.</li>
      </ul>
      <p>Les packs de contenus vendus à l'unité (Thermomètre du village, Saisons du village, etc.) ne sont pas inclus ; ils bénéficient de la réduction fondatrice de l'article 3.</p>

      <h2>Article 3 — Conditions financières</h2>
      <p><strong>Période fondatrice (12 mois)</strong> — la Commune verse <strong>1 € symbolique</strong> pour 12 mois d'accès complet. Cette période démarre à la date de mise en service de l'espace, confirmée par mail par le Prestataire${conv.date_debut_souhaitee ? ` (date souhaitée par la Commune : ${echapper(dateFr(conv.date_debut_souhaitee))})` : ''}. Cette somme remercie la Commune pour ses retours (article 4) et formalise la relation contractuelle.</p>
      <p><strong>Tarif fondateur, ensuite</strong> — à l'issue des 12 mois, la Commune peut souscrire l'offre de son choix avec <strong>35 % de réduction sur la grille publique</strong> de plateforme-agora.fr en vigueur. ${dureeAbonnement}</p>
      <p>La réduction est garantie sans limite de durée tant que l'abonnement se poursuit sans interruption. Une interruption de plus de 3 mois met fin au tarif fondateur. Elle s'applique aussi aux packs de contenus.</p>
      ${preavis}
      <p><strong>Paiement</strong> — l'abonnement est facturé annuellement, en début de période.</p>
      <p><strong>Pas de passage automatique au payant</strong> — la souscription de l'abonnement payant nécessite une décision expresse de la Commune (bon de commande ou délibération). Sans décision, l'espace bascule sur la version gratuite (actualités, agenda, alertes) : rien n'est supprimé et les habitants gardent leur compte.</p>
      <table>
        <thead><tr><th></th><th>Période fondatrice</th><th>Après 12 mois</th></tr></thead>
        <tbody>
          <tr><td>Prix</td><td>1 €</td><td>Grille du site − 35 %, tant que l'abonnement est continu</td></tr>
          <tr><td>Durée</td><td>12 mois à compter de la mise en service</td><td>${dureeTableau}</td></tr>
          <tr><td>Onglets</td><td>Tous</td><td>Selon l'offre choisie</td></tr>
          <tr><td>Si aucune décision</td><td>—</td><td>Version gratuite, données conservées</td></tr>
        </tbody>
      </table>
      <p><strong>Facturation</strong> — une facture de 1 €, déposée sur Chorus Pro${conv.code_service_chorus ? ` (code service : ${echapper(conv.code_service_chorus)})` : ''}, avec la mention « ${ou(entreprise.entreprise_mention_tva)} ». Contact facturation de la Commune : ${contactFacturation}. Le montant permet un achat sans publicité ni mise en concurrence (art. R2122-8 du Code de la commande publique).</p>

      <h2>Article 4 — Engagements réciproques</h2>
      <p><strong>La Commune s'engage à :</strong></p>
      <ol>
        <li>Signaler les dysfonctionnements constatés (par mail ou depuis l'application), avec si possible une capture d'écran.</li>
        <li>Partager ses retours sur l'usage : ce qui fonctionne, ce qui manque, ce que disent les habitants et les élus.</li>
        <li>Participer à un point d'échange d'environ 30 minutes par trimestre (téléphone ou visio).</li>
        <li>Autoriser le Prestataire à citer son nom comme commune utilisatrice : ${citation}. Aucun chiffre d'usage ni témoignage ne sera publié sans accord écrit.</li>
      </ol>
      <p><strong>Le Prestataire s'engage à :</strong></p>
      <ol>
        <li>Maintenir le service en ligne et corriger les anomalies bloquantes en priorité.</li>
        <li>Répondre aux demandes sous 2 jours ouvrés.</li>
        <li>Étudier chaque suggestion et informer la Commune des suites données.</li>
        <li>Accompagner la prise en main (paramétrage, logo, couleurs, premiers contenus).</li>
      </ol>
      <p><strong>Données personnelles</strong> — la Commune est responsable du traitement des données de ses habitants ; le Prestataire agit comme sous-traitant (article 28 du RGPD). Les données sont hébergées dans l'Union européenne et ne sont ni vendues ni utilisées à des fins publicitaires. L'accord de sous-traitance (DPA) est joint en annexe.</p>

      <h2>Article 5 — Durée, résiliation et données</h2>
      <p><strong>Durée</strong> — la période fondatrice court 12 mois à compter de la mise en service. Le statut de Commune fondatrice et la réduction de 35 % restent acquis au-delà, dans les conditions de l'article 3.</p>
      <p><strong>Résiliation</strong> — la Commune peut mettre fin à la convention à tout moment, par simple mail, sans pénalité ; l'euro versé reste acquis. Le Prestataire ne peut résilier qu'en cas de manquement grave, après une mise en demeure restée sans effet 30 jours.</p>
      <p><strong>Fin de la convention</strong> — la Commune reçoit sur demande un export de ses contenus. Les données sont supprimées dans les 3 mois, sauf obligation légale de conservation.</p>
      <p><strong>Droit applicable</strong> — droit français. En cas de désaccord, les parties cherchent d'abord une solution amiable ; à défaut, le tribunal administratif d'Amiens est compétent.</p>
      <p><strong>Annexes</strong> — 1. Accord de sous-traitance des données (DPA) ; 2. Grille tarifaire en vigueur à la signature (plateforme-agora.fr).</p>

      <h2>Signatures</h2>
      <p>Fait en deux exemplaires, à ……………………, le ….. / ….. / ………</p>
      <div class="signatures">
        <div><b>Pour le Prestataire</b>Léandre SALLE<br>Signature :</div>
        <div><b>Pour la commune de ${nomCommune}</b>${conv.signataire_nom ? echapper(conv.signataire_nom) + ', ' : ''}${echapper(qualite)}<br>Signature et cachet :</div>
      </div>
    </div>
  `;
}

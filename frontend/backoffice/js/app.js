// frontend/backoffice/js/app.js — logique Alpine du tableau de bord backoffice.

// Instance Leaflet gardée hors de l'état réactif Alpine (un proxy réactif casserait Leaflet).
let carteLeaflet = null;
let couchePoints = null;

// Sélection sauvegardée avant l'ouverture d'un sélecteur de couleur natif (qui la fait perdre).
let selectionSauvegardee = null;

const COULEURS_STATUT = {
  a_contacter: '#94a3b8', contacte: '#38bdf8', relance: '#fbbf24',
  rdv: '#a78bfa', gagne: '#34d399', perdu: '#f87171',
};

// Mêmes libellés que frontend/js/moderation.js (LABELS_ONGLET), pour rester cohérent avec ce
// que voit un admin/élu côté application citoyenne.
const LABELS_ONGLET = {
  actualites: 'Actualités', alertes: 'Alertes', thermometre: 'Thermomètre',
  mur: 'Mur des voisins', agenda: 'Agenda', coups_de_main: 'Coup de main',
  chasse_tresor: 'Chasse au trésor', conseil: 'Conseil',
  annuaire: 'Annuaire', bulletin: 'Bulletin municipal', photo_du_jour: 'Photo du jour', enigmes: 'Trouve la photo',
  lois: 'Lois', memoire: 'Mémoire du village',
};

function backoffice() {
  return {
    vue: 'communes',      // 'communes' | 'fiche'
    chargement: true,
    staff: { nom: '' },
    apercu: {},
    // Tiroirs repliables (Communes clientes + Réglages) : état mémorisé pour garder
    // l'agencement préféré d'une visite à l'autre.
    tiroirsOuverts: (() => { try { return JSON.parse(localStorage.getItem('bo_tiroirs') || '{}'); } catch { return {}; } })(),
    communes: [],
    triCommunes: { cle: null, sens: 'asc' },
    pageCommunes: 1,
    paletteOuverte: false,
    paletteRecherche: '',
    paletteResultats: [],
    fiche: null,
    erreurChargement: '',
    frequentation: null,
    doublons: [],
    historiqueProspection: { prospect: null, interactions: [] },
    rgpd: null,
    qrCommune: '',
    chiffreAffaires: null,
    // — Activité (flux CRM cross-communes) —
    activite: [],
    resumeActivite: {
      comptes_7j: 0, comptes_30j: 0, publications_7j: 0, publications_30j: 0,
      communes_actives: 0, total_communes_clientes: null, auteurs_distincts: 0, publications_par_nouveau_compte: null, comptes_par_jour: 0,
    },
    pageActivite: 1,
    tailleActivite: 50,
    totalActivite: 0,
    filtreActiviteDepuis: 30,
    filtreActiviteTypes: [],
    filtreActiviteCommune: '',
    activiteCommune: [],       // flux borné à la commune ouverte, pour le tiroir de la fiche
    rolesGerables: ['citoyen', 'admin', 'elu', 'maire'],
    communeActiveId: null,
    communeActiveNom: '',
    utilisateurs: [],
    pageUtilisateurs: 1,
    totalUtilisateurs: 0,
    tailleUtilisateurs: 100,
    filtreUtilisateurRecherche: '',
    filtreUtilisateurRole: '',
    formUtilisateurOuvert: false,
    nouvelUtilisateur: { nom: '', prenom: '', email: '', role: 'citoyen', password: '' },
    utilisateurEdite: null,
    utilisateurEnCours: false,
    msgUtilisateurs: '',
    resetMdpResultat: '',
    coordsEnCours: false,
    coordsMsg: '',
    accesEnCours: false,
    accesMsg: '',
    accesGeneres: null,
    connexionMaireEnCours: false,
    forfaitNom: '',
    forfaitQuota: '',
    forfaitEnCours: false,
    forfaitMsg: '',
    presetEnCours: false,
    presetMsg: '',
    ongletsCommune: [],
    onboardingDrip: null,
    onboardingDripEnCours: false,
    onboardingDripMsg: '',
    onboardingDripRapport: null,
    presentEnCours: false,
    presentMsg: '',
    modele: { objet: '', corps_html: '', preview_text: '', angle_teste: '', signature_image_url: null, logo_image_url: null },
    modeEditeurEmail: 'visuel', // 'visuel' | 'code'
    modeleEnCours: false,
    modeleMsg: '',
    variantes: [],          // liste courte des variantes de l'email de présentation (A/B testing)
    varianteEditeeId: null, // id de la variante actuellement chargée dans l'éditeur
    varianteEnCours: false,
    varianteMsg: '',
    vueVarianteEmail: 'edition', // 'edition' | 'comparaison' — bascule dans le tiroir Modèle d'email
    apercuInboxMode: 'mobile', // 'mobile' | 'desktop' — bascule de l'aperçu boîte de réception
    testVarianteEnCours: false,
    testVarianteMsg: '',
    // Modèles génériques (bienvenue à la 1ère inscription, relance douce en cas d'inactivité) :
    // même mécanisme A/B que l'email de présentation ci-dessus (table modeles_email, routes
    // /administration/modeles-email/:cle), mais fonctions partagées entre les deux plutôt que
    // dupliquées — voir chargerModelesGeneriques et consorts.
    modelesGeneriques: {
      bienvenue_inscription: {
        variantes: [], editeeId: null,
        modele: { nom: '', objet: '', corps_html: '', preview_text: '', angle_teste: '' },
        enCours: false, msg: '', vue: 'edition', testEnCours: false, testMsg: '', modeEditeur: 'visuel',
      },
      relance_inactivite: {
        variantes: [], editeeId: null,
        modele: { nom: '', objet: '', corps_html: '', preview_text: '', angle_teste: '' },
        enCours: false, msg: '', vue: 'edition', testEnCours: false, testMsg: '', modeEditeur: 'visuel',
      },
      // Séquence d'onboarding/upsell des communes gratuites (voir backoffice/onboarding-drip.ts) —
      // mêmes fonctions génériques, juste 4 cle de plus.
      onboarding_relance_j3: {
        variantes: [], editeeId: null,
        modele: { nom: '', objet: '', corps_html: '', preview_text: '', angle_teste: '' },
        enCours: false, msg: '', vue: 'edition', testEnCours: false, testMsg: '', modeEditeur: 'visuel',
      },
      onboarding_checkin_j7: {
        variantes: [], editeeId: null,
        modele: { nom: '', objet: '', corps_html: '', preview_text: '', angle_teste: '' },
        enCours: false, msg: '', vue: 'edition', testEnCours: false, testMsg: '', modeEditeur: 'visuel',
      },
      onboarding_encouragement_j7: {
        variantes: [], editeeId: null,
        modele: { nom: '', objet: '', corps_html: '', preview_text: '', angle_teste: '' },
        enCours: false, msg: '', vue: 'edition', testEnCours: false, testMsg: '', modeEditeur: 'visuel',
      },
      onboarding_upsell: {
        variantes: [], editeeId: null,
        modele: { nom: '', objet: '', corps_html: '', preview_text: '', angle_teste: '' },
        enCours: false, msg: '', vue: 'edition', testEnCours: false, testMsg: '', modeEditeur: 'visuel',
      },
    },
    signatureEnCours: false,
    signatureMsg: '',
    logoEnCours: false,
    logoMsg: '',
    modeleFiche: { contenu_html: '' },
    modeEditeurFiche: 'visuel', // 'visuel' | 'code'
    modeleFicheEnCours: false,
    modeleFicheMsg: '',
    testEmailDest: '',
    testEmailEnCours: false,
    testEmailMsg: '',
    testEmailOk: false,
    testPresentationEnCours: false,
    testPresentationMsg: '',
    emailsRejetes: [],
    correctionEnCours: false,
    correctionMsg: '',
    grilleTarifaire: { tranches: [], mois_offerts_3ans: 0 },
    grilleEnCours: false,
    grilleMsg: '',
    ongletsDisponibles: [],
    ongletsGratuitsSelection: [],
    ongletsGratuitsEnCours: false,
    ongletsGratuitsMsg: '',
    parametresEntreprise: {},
    parametresEntrepriseEnCours: false,
    parametresEntrepriseMsg: '',
    staffListe: [],
    staffMsg: '',
    journalActivite: [],
    echeances: [],
    facturesEnAttente: [],
    onboardingSansContact: [],
    abonnementEnCours: false,
    abonnementMsg: '',
    nouveauDevis: { objet: '', montant_ht: '', taux_tva: 0, duree_engagement_mois: 12, validite_jours: 30 },
    devisListe: [],
    facturesListe: [],
    devisEnCours: false,
    devisMsg: '',

    // — Prospection —
    statuts: ['a_contacter', 'contacte', 'relance', 'rdv', 'gagne', 'perdu'],
    typesInteraction: ['note', 'appel', 'email', 'courrier', 'rdv'],
    prospects: [],
    apProsp: {},
    statsVariantes: [],
    rattrapageEnCours: false,
    rattrapageMsg: '',
    selectionProspects: {}, // id -> true
    pageProspects: 1,
    totalProspects: 0,
    tailleProspects: 100,
    lotEnCours: false,
    lotMsg: '',
    lotEchecs: [],
    statutLotChoisi: '',
    statutLotEnCours: false,
    envoiLigneId: null,   // id du prospect dont l'envoi ligne est en cours
    dernierEnvoiId: null, // id du dernier prospect envoyé (pour le ✓)
    filtreStatut: '',
    filtreDep: '',
    filtreRecherche: '',
    filtreTri: 'nom',
    filtreInscrits: false, // "🔥 s'est inscrit" — voir declencherBienvenuePremiereInscription côté serveur
    totalInscrits: 0,
    sousVueProspection: 'liste', // 'liste' | 'carte' | 'recues'
    emailsRecus: [],
    emailsRecusATraiter: 0,
    filtreEmailsRecusTraite: '0',
    filtreEmailsRecusCategorie: '',
    emailRecuEnCours: null,
    importDep: '',
    importPopMax: '',
    importEnCours: false,
    importMsg: '',
    prospect: null,
    interactions: [],
    enrichEnCours: false,
    prospEnCours: false,
    prospMsg: '',
    nouvInteraction: { type: 'note', contenu: '' },
    fermeture: { ouvert: false, dateRetour: '', enCours: false },
    conversion: { ouvert: false, enCours: false, succes: false, erreur: '', nom: '', slug: '', maireEmail: '', mairePrenom: '', maireNom: '', mairePassword: '', url: '' },

    async init() {
      try {
        const { staff } = await boFetch('/auth/me');
        this.staff = staff;
        this.testEmailDest = staff.email || '';
        try { await this.chargerVariantes(); } catch {}
        try { await this.chargerModelesGeneriques('bienvenue_inscription'); } catch {}
        try { await this.chargerModelesGeneriques('relance_inactivite'); } catch {}
        try { await this.chargerModelesGeneriques('onboarding_relance_j3'); } catch {}
        try { await this.chargerModelesGeneriques('onboarding_checkin_j7'); } catch {}
        try { await this.chargerModelesGeneriques('onboarding_encouragement_j7'); } catch {}
        try { await this.chargerModelesGeneriques('onboarding_upsell'); } catch {}
        try { this.modeleFiche.contenu_html = (await boFetch('/fiche-contenu')).contenu_html; } catch {}
        try { this.grilleTarifaire = await boFetch('/administration/grille-tarifaire'); } catch {}
        try {
          const r = await boFetch('/administration/onglets-gratuits');
          this.ongletsDisponibles = r.tous;
          this.ongletsGratuitsSelection = r.onglets;
        } catch {}
        try { this.statsVariantes = (await boFetch('/prospection/stats-variantes')).variantes; } catch {}
        try { this.parametresEntreprise = (await boFetch('/administration/parametres-entreprise')).parametres; } catch {}
      } catch {
        redirigerVersConnexion();
        return;
      }
      await this.chargerCommunes();
    },

    async chargerCommunes() {
      this.chargement = true;
      this.erreurChargement = '';
      try {
        const [apercu, liste] = await Promise.all([
          boFetch('/administration/apercu'),
          boFetch('/administration/communes'),
        ]);
        this.apercu = apercu;
        this.communes = liste.communes;
        try { this.emailsRejetes = (await boFetch('/administration/emails-rejetes')).emails; } catch {}
        try {
          const r = await boFetch('/administration/echeances');
          this.echeances = r.communes;
          this.facturesEnAttente = r.factures;
        } catch {}
        try { this.onboardingSansContact = (await boFetch('/administration/onboarding-drip/a-traiter')).communes; } catch {}
      } catch (e) {
        // Ne pas rester silencieusement vide : afficher la cause (souvent une migration manquante).
        this.erreurChargement = e.message || 'Erreur de chargement des communes';
      } finally {
        this.chargement = false;
      }
    },

    async ouvrirFiche(id) {
      this.chargement = true;
      this.vue = 'fiche';
      this.coordsMsg = '';
      this.accesMsg = '';
      this.accesGeneres = null;
      this.forfaitMsg = '';
      this.presentMsg = '';
      this.frequentation = null;
      this.doublons = [];
      this.historiqueProspection = { prospect: null, interactions: [] };
      this.rgpd = null;
      this.qrCommune = '';
      this.activiteCommune = [];
      try {
        this.fiche = await boFetch('/administration/communes/' + id);
        this.forfaitNom = this.fiche.commune.forfait || '';
        this.forfaitQuota = this.fiche.commune.quota_go ?? '';
        if (!this.fiche.commune.statut_client) this.fiche.commune.statut_client = 'active';
        this.qrCommune = this.genererQr(location.origin + '/' + this.fiche.commune.slug + '/');
        try { this.frequentation = await boFetch('/administration/communes/' + id + '/frequentation'); } catch {}
        try { this.doublons = (await boFetch('/administration/communes/' + id + '/doublons')).doublons; } catch {}
        try { this.historiqueProspection = await boFetch('/administration/communes/' + id + '/historique-prospection'); } catch {}
        try { this.activiteCommune = (await boFetch('/administration/activite?commune_id=' + id + '&depuis=90')).evenements; } catch {}
        try { this.rgpd = await boFetch('/administration/communes/' + id + '/rgpd'); } catch {}
        this.nouveauDevis = { objet: '', montant_ht: '', taux_tva: 0, duree_engagement_mois: 12, validite_jours: 30 };
        this.devisMsg = '';
        try { await this.chargerDevisFactures(id); } catch {}
        try { this.ongletsCommune = (await boFetch('/administration/communes/' + id + '/onglets')).onglets; } catch {}
        this.onboardingDripMsg = '';
        try { this.onboardingDrip = await boFetch('/administration/onboarding-drip/communes/' + id); } catch { this.onboardingDrip = null; }
      } finally {
        this.chargement = false;
      }
    },

    // Séquence d'onboarding/upsell (voir backoffice/onboarding-drip.ts) : déclenche MAINTENANT,
    // sans attendre le cron quotidien — pratique pour tester après avoir modifié created_at
    // et/ou ajouté des lignes dans activation_events pour cette commune depuis Supabase.
    async declencherSequenceOnboardingMaintenant() {
      if (!confirm('Ça va lancer la séquence pour TOUTES les communes éligibles à cet instant (pas seulement celle-ci) — de vrais emails peuvent partir. Continuer ?')) return;
      this.onboardingDripEnCours = true;
      this.onboardingDripMsg = '';
      this.onboardingDripRapport = null;
      try {
        const r = await boFetch('/administration/onboarding-drip/executer', { method: 'POST' });
        this.onboardingDripRapport = r.rapport;
        this.onboardingDrip = await boFetch('/administration/onboarding-drip/communes/' + this.fiche.commune.id);
        this.onboardingDripMsg = 'Séquence exécutée — détail ci-dessous, état de cette commune mis à jour ci-dessus.';
      } catch (e) {
        this.onboardingDripMsg = e.message || 'Échec';
      } finally {
        this.onboardingDripEnCours = false;
      }
    },

    async majStatutClient() {
      try {
        await boFetch('/administration/communes/' + this.fiche.commune.id + '/statut', {
          method: 'PATCH', body: JSON.stringify({ statut_client: this.fiche.commune.statut_client }),
        });
      } catch (e) { alert(e.message || 'Mise à jour impossible'); }
    },

    async envoyerPresentationCommune() {
      if (!confirm('Envoyer l\'email de présentation à cette commune ?')) return;
      this.presentEnCours = true;
      this.presentMsg = '';
      try {
        const r = await boFetch('/administration/communes/' + this.fiche.commune.id + '/envoyer-presentation', { method: 'POST' });
        this.presentMsg = 'Présentation envoyée à ' + r.email;
      } catch (e) {
        this.presentMsg = e.message || 'Envoi impossible';
      } finally {
        this.presentEnCours = false;
      }
    },

    async uploaderSignature(e) {
      const fichier = e.target.files && e.target.files[0];
      if (!fichier) return;
      this.signatureEnCours = true;
      this.signatureMsg = '';
      try {
        const r = await boFetch('/administration/signature', {
          method: 'POST', headers: { 'Content-Type': fichier.type }, body: fichier,
        });
        this.modele.signature_image_url = r.url;
        this.signatureMsg = 'Photo enregistrée.';
      } catch (err) {
        this.signatureMsg = err.message || 'Échec de l\'envoi';
      } finally {
        this.signatureEnCours = false;
        e.target.value = '';
      }
    },

    initEditeurFiche() {
      const ed = document.getElementById('editeur-fiche');
      if (ed) ed.innerHTML = this.modeleFiche.contenu_html || '';
    },
    basculerModeFiche() {
      const ed = document.getElementById('editeur-fiche');
      if (this.modeEditeurFiche === 'visuel') {
        if (ed) this.modeleFiche.contenu_html = ed.innerHTML;
        this.modeEditeurFiche = 'code';
      } else {
        this.modeEditeurFiche = 'visuel';
        if (ed) ed.innerHTML = this.modeleFiche.contenu_html || '';
      }
      this.synchroniserApercuFiche();
    },
    // Pousse le brouillon en cours (pas encore enregistré) dans l'iframe d'aperçu, par
    // postMessage — voir frontend/backoffice/js/fiche.js. Permet de voir le vrai rendu A4 sans
    // avoir à enregistrer à chaque essai.
    synchroniserApercuFiche() {
      const ed = document.getElementById('editeur-fiche');
      if (this.modeEditeurFiche === 'visuel' && ed) this.modeleFiche.contenu_html = ed.innerHTML;
      const iframe = document.getElementById('apercu-fiche-iframe');
      if (!iframe || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage({
        type: 'apercu-fiche',
        contenu_html: this.modeleFiche.contenu_html,
        logo_url: this.modele.logo_image_url || null,
      }, window.location.origin);
    },

    async enregistrerModeleFiche() {
      const ed = document.getElementById('editeur-fiche');
      if (this.modeEditeurFiche === 'visuel' && ed) this.modeleFiche.contenu_html = ed.innerHTML;
      this.modeleFicheEnCours = true;
      this.modeleFicheMsg = '';
      try {
        await boFetch('/administration/modele-fiche', {
          method: 'PUT', body: JSON.stringify({ contenu_html: this.modeleFiche.contenu_html }),
        });
        this.modeleFicheMsg = 'Fiche enregistrée.';
      } catch (e) {
        this.modeleFicheMsg = e.message || 'Échec';
      } finally {
        this.modeleFicheEnCours = false;
      }
    },

    async uploaderLogo(e) {
      const fichier = e.target.files && e.target.files[0];
      if (!fichier) return;
      this.logoEnCours = true;
      this.logoMsg = '';
      try {
        const r = await boFetch('/administration/logo-email', {
          method: 'POST', headers: { 'Content-Type': fichier.type }, body: fichier,
        });
        this.modele.logo_image_url = r.url;
        this.logoMsg = 'Logo enregistré.';
      } catch (err) {
        this.logoMsg = err.message || 'Échec de l\'envoi';
      } finally {
        this.logoEnCours = false;
        e.target.value = '';
      }
    },

    // — Éditeurs visuels (WYSIWYG). Les commandes agissent sur l'éditeur qui a le focus
    //   (grâce à @mousedown.prevent sur les boutons), donc valables pour l'email ET la fiche. —
    initEditeurEmail() {
      const ed = document.getElementById('editeur-email');
      if (ed) ed.innerHTML = this.modele.corps_html || '';
    },

    // — Variantes de l'email de présentation (A/B testing) —
    async rafraichirListeVariantes() {
      const r = await boFetch('/administration/modeles-presentation');
      this.variantes = r.variantes;
    },
    async chargerVariantes() {
      await this.rafraichirListeVariantes();
      const active = this.variantes.find((v) => v.actif) || this.variantes[0];
      if (active) await this.chargerVariante(active.id);
    },
    async chargerVariante(id) {
      const r = await boFetch('/administration/modeles-presentation/' + id);
      this.varianteEditeeId = id;
      this.modele = r.variante;
      this.varianteMsg = '';
      const ed = document.getElementById('editeur-email');
      if (ed && this.modeEditeurEmail === 'visuel') ed.innerHTML = this.modele.corps_html || '';
    },
    async nouvelleVariante() {
      const nom = prompt('Nom de la nouvelle variante (ex. « B - accroche courte ») :');
      if (!nom) return;
      // Reprend le contenu actuellement affiché comme point de départ (mode visuel : on le
      // récupère depuis l'éditeur avant de dupliquer).
      const ed = document.getElementById('editeur-email');
      if (this.modeEditeurEmail === 'visuel' && ed) this.modele.corps_html = ed.innerHTML;
      this.varianteEnCours = true;
      this.varianteMsg = '';
      try {
        const r = await boFetch('/administration/modeles-presentation', {
          method: 'POST',
          body: JSON.stringify({
            nom, objet: this.modele.objet, corps_html: this.modele.corps_html,
            preview_text: this.modele.preview_text || null, angle_teste: this.modele.angle_teste || null,
          }),
        });
        await this.chargerVariantes();
        await this.chargerVariante(r.variante.id);
        this.varianteMsg = 'Variante créée à partir du contenu actuel.';
      } catch (e) {
        this.varianteMsg = e.message || 'Échec';
      } finally {
        this.varianteEnCours = false;
      }
    },
    async activerVariante() {
      this.varianteEnCours = true;
      this.varianteMsg = '';
      try {
        const r = await boFetch('/administration/modeles-presentation/' + this.varianteEditeeId + '/activer', { method: 'POST' });
        await this.chargerVariantes();
        this.varianteMsg = `« ${r.nom} » est maintenant active — c'est elle qui part dans les envois.`;
      } catch (e) {
        this.varianteMsg = e.message || 'Échec';
      } finally {
        this.varianteEnCours = false;
      }
    },
    async supprimerVariante() {
      if (!confirm('Supprimer cette variante ? Cette action est définitive.')) return;
      this.varianteEnCours = true;
      this.varianteMsg = '';
      try {
        await boFetch('/administration/modeles-presentation/' + this.varianteEditeeId, { method: 'DELETE' });
        await this.chargerVariantes();
        this.varianteMsg = 'Variante supprimée.';
      } catch (e) {
        this.varianteMsg = e.message || 'Échec';
      } finally {
        this.varianteEnCours = false;
      }
    },

    // — Modèles génériques (bienvenue inscription, relance inactivité) : mêmes actions que
    //   ci-dessus pour l'email de présentation, mais paramétrées par `cle` et partagées entre
    //   les deux types plutôt que dupliquées. —
    async rafraichirListeVarianteGenerique(cle) {
      const r = await boFetch('/administration/modeles-email/' + cle);
      this.modelesGeneriques[cle].variantes = r.variantes;
    },
    async chargerModelesGeneriques(cle) {
      await this.rafraichirListeVarianteGenerique(cle);
      const etat = this.modelesGeneriques[cle];
      const active = etat.variantes.find((v) => v.actif) || etat.variantes[0];
      if (active) await this.chargerVarianteGenerique(cle, active.id);
    },
    async chargerVarianteGenerique(cle, id) {
      if (!id) return;
      const etat = this.modelesGeneriques[cle];
      const r = await boFetch('/administration/modeles-email/' + cle + '/' + id);
      etat.editeeId = id;
      etat.modele = r.variante;
      etat.msg = '';
      const ed = document.getElementById('editeur-email-' + cle);
      if (ed && etat.modeEditeur === 'visuel') ed.innerHTML = etat.modele.corps_html || '';
    },
    // Éditeur visuel (WYSIWYG) des modèles génériques — mêmes commandes que exec()/couleurTexte()
    // etc. ci-dessous (déjà cle-agnostiques, elles agissent sur l'élément focus du navigateur),
    // seuls le ciblage par id et la synchro avec le bon `modele` sont spécifiques à ce cle.
    initEditeurEmailGenerique(cle) {
      const ed = document.getElementById('editeur-email-' + cle);
      if (ed) ed.innerHTML = this.modelesGeneriques[cle].modele.corps_html || '';
    },
    basculerModeEditeurGenerique(cle) {
      const etat = this.modelesGeneriques[cle];
      const ed = document.getElementById('editeur-email-' + cle);
      if (etat.modeEditeur === 'visuel') {
        if (ed) etat.modele.corps_html = ed.innerHTML;
        etat.modeEditeur = 'code';
      } else {
        etat.modeEditeur = 'visuel';
        if (ed) ed.innerHTML = etat.modele.corps_html || '';
      }
    },
    async nouvelleVarianteGenerique(cle) {
      const nom = prompt('Nom de la nouvelle variante (ex. « B - ton plus direct ») :');
      if (!nom) return;
      const etat = this.modelesGeneriques[cle];
      // Reprend le contenu actuellement affiché comme point de départ (mode visuel : on le
      // récupère depuis l'éditeur avant de dupliquer).
      const ed = document.getElementById('editeur-email-' + cle);
      if (etat.modeEditeur === 'visuel' && ed) etat.modele.corps_html = ed.innerHTML;
      etat.enCours = true;
      etat.msg = '';
      try {
        const r = await boFetch('/administration/modeles-email/' + cle, {
          method: 'POST',
          body: JSON.stringify({
            nom, objet: etat.modele.objet, corps_html: etat.modele.corps_html,
            preview_text: etat.modele.preview_text || null, angle_teste: etat.modele.angle_teste || null,
          }),
        });
        await this.rafraichirListeVarianteGenerique(cle);
        await this.chargerVarianteGenerique(cle, r.variante.id);
        etat.msg = 'Variante créée à partir du contenu actuel.';
      } catch (e) {
        etat.msg = e.message || 'Échec';
      } finally {
        etat.enCours = false;
      }
    },
    async activerVarianteGenerique(cle) {
      const etat = this.modelesGeneriques[cle];
      etat.enCours = true;
      etat.msg = '';
      try {
        const r = await boFetch('/administration/modeles-email/' + cle + '/' + etat.editeeId + '/activer', { method: 'POST' });
        await this.rafraichirListeVarianteGenerique(cle);
        etat.msg = `« ${r.nom} » est maintenant active — c'est elle qui part dans les envois.`;
      } catch (e) {
        etat.msg = e.message || 'Échec';
      } finally {
        etat.enCours = false;
      }
    },
    async supprimerVarianteGenerique(cle) {
      if (!confirm('Supprimer cette variante ? Cette action est définitive.')) return;
      const etat = this.modelesGeneriques[cle];
      etat.enCours = true;
      etat.msg = '';
      try {
        await boFetch('/administration/modeles-email/' + cle + '/' + etat.editeeId, { method: 'DELETE' });
        await this.chargerModelesGeneriques(cle);
        etat.msg = 'Variante supprimée.';
      } catch (e) {
        etat.msg = e.message || 'Échec';
      } finally {
        etat.enCours = false;
      }
    },
    async enregistrerVarianteGenerique(cle) {
      const etat = this.modelesGeneriques[cle];
      // En mode visuel, on récupère le HTML produit par l'éditeur avant d'enregistrer.
      const ed = document.getElementById('editeur-email-' + cle);
      if (etat.modeEditeur === 'visuel' && ed) etat.modele.corps_html = ed.innerHTML;
      etat.enCours = true;
      etat.msg = '';
      try {
        await boFetch('/administration/modeles-email/' + cle + '/' + etat.editeeId, {
          method: 'PUT',
          body: JSON.stringify({
            nom: etat.modele.nom, objet: etat.modele.objet, corps_html: etat.modele.corps_html,
            preview_text: etat.modele.preview_text || null, angle_teste: etat.modele.angle_teste || null,
          }),
        });
        await this.rafraichirListeVarianteGenerique(cle);
        etat.msg = 'Modèle enregistré.';
      } catch (e) {
        etat.msg = e.message || 'Échec';
      } finally {
        etat.enCours = false;
      }
    },

    ouvrirEditionVarianteGenerique(cle, id) {
      this.modelesGeneriques[cle].vue = 'edition';
      this.chargerVarianteGenerique(cle, id);
    },

    // Envoie un test de la variante ouverte dans l'éditeur (pas forcément l'active) — même
    // logique que envoyerTestVariante, mais pour les modèles génériques (pas de suivi
    // ouverture/clic sur ceux-ci, voir commentaire de la route côté Worker).
    async envoyerTestGenerique(cle) {
      const etat = this.modelesGeneriques[cle];
      if (!etat.editeeId) return;
      etat.testEnCours = true;
      etat.testMsg = '';
      try {
        const r = await boFetch('/administration/email-test-generique/' + cle, {
          method: 'POST',
          body: JSON.stringify({ destinataire: this.testEmailDest, variante_id: etat.editeeId }),
        });
        etat.testMsg = `Envoyé à ${r.destinataire} (variante « ${r.variante || '—'} »).`;
      } catch (e) {
        etat.testMsg = e.message || 'Échec de l\'envoi';
      } finally {
        etat.testEnCours = false;
      }
    },

    // Aperçu rendu du corps pour les modèles génériques : seulement {{commune}}/{{url}} (pas
    // de logo/signature sur ces messages courts et personnels).
    rendreApercuGenerique(corpsHtml) {
      return (corpsHtml || '')
        .replace(/\{\{commune\}\}/g, 'Commune Test')
        .replace(/\{\{url\}\}/g, 'https://plateforme-agora.fr/commune-test/');
    },

    exec(commande, valeur = null) {
      document.execCommand(commande, false, valeur);
    },
    couleurTexte(couleur) {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, couleur);
    },
    surligner(couleur) {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('hiliteColor', false, couleur);
    },
    // Sélecteur de couleur natif : on mémorise la sélection avant l'ouverture du sélecteur…
    sauvegarderSelection() {
      const sel = window.getSelection();
      selectionSauvegardee = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    },
    // …puis on la restaure avant d'appliquer la couleur choisie.
    restaurerSelection() {
      if (!selectionSauvegardee) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(selectionSauvegardee);
    },
    couleurTexteLibre(couleur) {
      this.restaurerSelection();
      this.couleurTexte(couleur);
    },
    surlignerLibre(couleur) {
      this.restaurerSelection();
      this.surligner(couleur);
    },
    insererVariable(texte) {
      document.execCommand('insertText', false, texte);
    },
    insererLien() {
      // Le prompt fait perdre la sélection dans l'éditeur : on la sauvegarde puis on la restaure.
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      const url = prompt('Adresse du lien (https://…) :');
      if (!url) return;
      if (range) { sel.removeAllRanges(); sel.addRange(range); }
      document.execCommand('createLink', false, url);
    },
    insererBoutonCta() {
      const bouton = '<a href="{{url}}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Découvrir l\'application</a>&nbsp;';
      this.exec('insertHTML', bouton);
    },
    basculerModeEditeur() {
      const ed = document.getElementById('editeur-email');
      if (this.modeEditeurEmail === 'visuel') {
        if (ed) this.modele.corps_html = ed.innerHTML; // récupère le HTML avant de montrer le code
        this.modeEditeurEmail = 'code';
      } else {
        this.modeEditeurEmail = 'visuel';
        if (ed) ed.innerHTML = this.modele.corps_html || ''; // réinjecte dans l'éditeur
      }
    },

    async enregistrerModele() {
      // En mode visuel, on récupère le HTML produit par l'éditeur avant d'enregistrer.
      const ed = document.getElementById('editeur-email');
      if (this.modeEditeurEmail === 'visuel' && ed) this.modele.corps_html = ed.innerHTML;
      this.modeleEnCours = true;
      this.modeleMsg = '';
      try {
        await boFetch('/administration/modeles-presentation/' + this.varianteEditeeId, {
          method: 'PUT',
          body: JSON.stringify({
            nom: this.modele.nom, objet: this.modele.objet, corps_html: this.modele.corps_html,
            preview_text: this.modele.preview_text || null, angle_teste: this.modele.angle_teste || null,
          }),
        });
        await this.rafraichirListeVariantes();
        this.modeleMsg = 'Modèle enregistré.';
      } catch (e) {
        this.modeleMsg = e.message || 'Échec';
      } finally {
        this.modeleEnCours = false;
      }
    },

    async appliquerPresetOnglets(preset) {
      const libelle = preset === 'complet' ? 'Version complète (tous les modules)' : 'Gratuit (périmètre défini dans Réglages)';
      if (!confirm(`Basculer cette commune sur le préréglage « ${libelle} » ?`)) return;
      this.presetEnCours = true;
      this.presetMsg = '';
      try {
        const r = await boFetch('/administration/communes/' + this.fiche.commune.id + '/onglets/preset', {
          method: 'POST', body: JSON.stringify({ preset }),
        });
        this.fiche.commune.forfait = r.forfait;
        this.forfaitNom = r.forfait;
        this.presetMsg = 'Appliqué : ' + r.forfait;
        try { this.ongletsCommune = (await boFetch('/administration/communes/' + this.fiche.commune.id + '/onglets')).onglets; } catch {}
      } catch (e) {
        this.presetMsg = e.message || 'Échec';
      } finally {
        this.presetEnCours = false;
      }
    },
    async toggleOngletCommune(o) {
      const nouveauActif = !o.actif;
      o.actif = nouveauActif;
      try {
        await boFetch('/administration/communes/' + this.fiche.commune.id + '/onglets/' + o.cle, {
          method: 'PATCH', body: JSON.stringify({ actif: nouveauActif }),
        });
      } catch (e) {
        o.actif = !nouveauActif;
        alert(e.message || 'Échec');
      }
    },

    async enregistrerForfait() {
      this.forfaitEnCours = true;
      this.forfaitMsg = '';
      try {
        const quota = this.forfaitQuota === '' || this.forfaitQuota === null ? null : Number(this.forfaitQuota);
        const r = await boFetch('/administration/communes/' + this.fiche.commune.id + '/forfait', {
          method: 'PATCH', body: JSON.stringify({ forfait: this.forfaitNom || null, quota_go: quota }),
        });
        this.fiche.commune.forfait = r.forfait ?? null;
        this.fiche.commune.quota_go = r.quota_go ?? null;
        this.forfaitMsg = 'Enregistré.';
      } catch (e) {
        this.forfaitMsg = e.message || 'Échec';
      } finally {
        this.forfaitEnCours = false;
      }
    },

    pourcentageStockage() {
      const q = this.fiche.commune.quota_go;
      if (!q) return 0;
      return Math.round((this.fiche.stockage.octets / (q * 1024 ** 3)) * 100);
    },
    classeJauge() {
      const p = this.pourcentageStockage();
      if (p >= 100) return 'bo-jauge__rempli--plein';
      if (p >= 80) return 'bo-jauge__rempli--alerte';
      return '';
    },

    // Ouvre une session côté app citoyenne pour le maire, sans toucher à son mot de passe —
    // à la différence de renvoyerAcces() ci-dessous. Réutilisable à volonté sur n'importe quelle
    // commune pour la configurer soi-même, sans jamais risquer de couper les vrais accès du maire.
    async seConnecterEnTantQueMaire() {
      this.connexionMaireEnCours = true;
      this.accesMsg = '';
      try {
        const r = await boFetch('/administration/communes/' + this.fiche.commune.id + '/se-connecter-en-tant-que', { method: 'POST' });
        window.open('/' + r.slug + '/', '_blank', 'noopener');
      } catch (e) {
        this.accesMsg = e.message || 'Connexion impossible';
      } finally {
        this.connexionMaireEnCours = false;
      }
    },
    async renvoyerAcces() {
      if (!confirm('Régénérer un mot de passe temporaire et renvoyer l\'email au maire ? Écrase son mot de passe actuel (à réserver au cas où il a vraiment perdu ses accès — pour te connecter toi-même, utilise plutôt « Se connecter en tant que »).')) return;
      this.accesEnCours = true;
      this.accesMsg = '';
      this.accesGeneres = null;
      try {
        const r = await boFetch('/administration/communes/' + this.fiche.commune.id + '/renvoyer-acces', { method: 'POST' });
        this.accesMsg = 'Accès renvoyés à ' + r.email;
        // Affiché une seule fois ici (pas stocké ailleurs) : le mot de passe précédent n'est de
        // toute façon plus valable, celui-ci vient de le remplacer.
        this.accesGeneres = { email: r.email, motDePasse: r.mot_de_passe };
      } catch (e) {
        this.accesMsg = e.message || 'Envoi impossible';
      } finally {
        this.accesEnCours = false;
      }
    },
    copierAccesGeneres() {
      if (!this.accesGeneres) return;
      navigator.clipboard?.writeText(`${this.accesGeneres.email} / ${this.accesGeneres.motDePasse}`);
    },

    async recupererCoords() {
      this.coordsEnCours = true;
      this.coordsMsg = '';
      try {
        const r = await boFetch('/administration/communes/' + this.fiche.commune.id + '/coordonnees', { method: 'POST' });
        this.fiche.commune.lat = r.lat;
        this.fiche.commune.lng = r.lng;
        this.coordsMsg = 'Coordonnées mises à jour.';
      } catch (e) {
        this.coordsMsg = e.message || 'Introuvables';
      } finally {
        this.coordsEnCours = false;
      }
    },

    allerCommunes() {
      this.vue = 'communes';
      this.fiche = null;
    },

    allerReglages() {
      this.vue = 'reglages';
    },

    // — Chiffre d'affaires : réel (factures encaissées) vs projection (abonnements actifs),
    //   jamais mélangés dans un même total (voir GET /administration/chiffre-affaires). —
    async allerChiffreAffaires() {
      this.vue = 'chiffre_affaires';
      this.erreurChargement = '';
      try {
        this.chiffreAffaires = await boFetch('/administration/chiffre-affaires');
      } catch (e) {
        this.erreurChargement = e.message || "Erreur de chargement du chiffre d'affaires";
      }
    },
    maxCaMois() {
      if (!this.chiffreAffaires) return 0;
      return Math.max(1, ...this.chiffreAffaires.ca_reel.par_mois.map((m) => m.montant));
    },
    libelleMois(cle) {
      const [annee, mois] = cle.split('-').map(Number);
      return new Date(annee, mois - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    },
    libelleChurnType(t) {
      return t === 'passage_gratuit' ? 'Repassée en gratuit' : t === 'resiliation' ? 'Résiliée' : t;
    },

    // — Activité (flux CRM cross-communes) —
    async allerActivite() {
      this.vue = 'activite';
      this.pageActivite = 1;
      await this.chargerActivite();
    },
    appliquerFiltresActivite() {
      this.pageActivite = 1;
      this.chargerActivite();
    },
    async chargerActivite() {
      this.erreurChargement = '';
      const params = new URLSearchParams();
      if (this.filtreActiviteDepuis) params.set('depuis', this.filtreActiviteDepuis);
      if (this.filtreActiviteTypes.length) params.set('types', this.filtreActiviteTypes.join(','));
      if (this.filtreActiviteCommune) params.set('commune_id', this.filtreActiviteCommune);
      params.set('page', this.pageActivite);
      try {
        const r = await boFetch('/administration/activite' + (params.toString() ? '?' + params : ''));
        this.activite = r.evenements;
        this.totalActivite = r.total ?? r.evenements.length;
        this.tailleActivite = r.taille ?? 50;
        this.resumeActivite = r.resume;
      } catch (e) {
        this.erreurChargement = e.message || "Erreur de chargement de l'activité";
      }
    },
    basculerTypeActivite(type) {
      const i = this.filtreActiviteTypes.indexOf(type);
      if (i === -1) this.filtreActiviteTypes.push(type); else this.filtreActiviteTypes.splice(i, 1);
      this.appliquerFiltresActivite();
    },
    nbPagesActivite() {
      return Math.max(1, Math.ceil(this.totalActivite / this.tailleActivite));
    },
    allerPageActivite(delta) {
      const cible = Math.min(this.nbPagesActivite(), Math.max(1, this.pageActivite + delta));
      if (cible === this.pageActivite) return;
      this.pageActivite = cible;
      this.chargerActivite();
    },
    libelleTypeActivite(type) {
      const labels = {
        compte: 'Nouveau compte', article: 'Actu publiée', alerte: 'Signalement/alerte',
        mur: 'Post mur des voisins', agenda: 'Événement agenda', entraide: 'Coup de main',
        memoire: 'Mémoire du village', photo: 'Photo du jour', sondage: 'Sondage',
      };
      return labels[type] || type;
    },
    iconeTypeActivite(type) {
      const icones = {
        compte: '🆕', article: '📰', alerte: '🚨', mur: '💬', agenda: '📅',
        entraide: '🤝', memoire: '📖', photo: '📷', sondage: '📊',
      };
      return icones[type] || '•';
    },

    // — Prospection —
    async allerProspection() {
      this.vue = 'prospection';
      this.prospect = null;
      this.sousVueProspection = 'liste';
      this.pageProspects = 1;
      await this.chargerProspects();
    },

    // Filtres (statut/dept/recherche/tri) → on repart page 1.
    appliquerFiltres() {
      this.pageProspects = 1;
      this.chargerProspects();
    },
    urlExportProspects() {
      const params = new URLSearchParams();
      if (this.filtreStatut) params.set('statut', this.filtreStatut);
      if (this.filtreDep) params.set('departement', this.filtreDep);
      if (this.filtreRecherche) params.set('recherche', this.filtreRecherche);
      return '/api/backoffice/prospection/prospects-export.csv' + (params.toString() ? '?' + params : '');
    },
    nbPagesProspects() {
      return Math.max(1, Math.ceil(this.totalProspects / this.tailleProspects));
    },
    allerPageProspects(delta) {
      const cible = Math.min(this.nbPagesProspects(), Math.max(1, this.pageProspects + delta));
      if (cible === this.pageProspects) return;
      this.pageProspects = cible;
      this.chargerProspects();
    },

    async afficherCarte() {
      this.sousVueProspection = 'carte';
      await this.$nextTick();
      this.initCarte();
      await this.chargerMarqueurs();
      if (carteLeaflet) carteLeaflet.invalidateSize();
    },

    async afficherEmailsRecus() {
      this.sousVueProspection = 'recues';
      await this.chargerEmailsRecus();
    },
    async chargerEmailsRecus() {
      const params = new URLSearchParams();
      if (this.filtreEmailsRecusTraite) params.set('traite', this.filtreEmailsRecusTraite);
      if (this.filtreEmailsRecusCategorie) params.set('categorie', this.filtreEmailsRecusCategorie);
      try {
        const r = await boFetch('/prospection/emails-recus?' + params);
        this.emailsRecus = r.emails;
        this.emailsRecusATraiter = r.a_traiter;
      } catch { /* liste vide plutôt que de casser l'écran */ }
    },
    async marquerEmailRecuTraite(email, traite) {
      this.emailRecuEnCours = email.id;
      try {
        await boFetch('/prospection/emails-recus/' + email.id, { method: 'PATCH', body: JSON.stringify({ traite }) });
        await this.chargerEmailsRecus();
      } catch (e) {
        alert(e.message || 'Mise à jour impossible');
      } finally {
        this.emailRecuEnCours = null;
      }
    },
    libelleCategorieEmailRecu(cat) {
      return { fermeture: '🏛 Fermeture', changement_email: '📧 Changement d\'adresse', autre: '❓ Autre' }[cat] || cat;
    },

    initCarte() {
      const el = document.getElementById('carte-prospection');
      if (!el) return;
      // Recrée la carte si l'ancienne instance pointe vers un DOM disparu (vue re-montée).
      if (carteLeaflet && carteLeaflet._container !== el) { carteLeaflet.remove(); carteLeaflet = null; }
      if (carteLeaflet) return;
      carteLeaflet = L.map(el, { scrollWheelZoom: true }).setView([46.6, 2.4], 6); // centre France
      L.tileLayer(
        'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
        { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 20 },
      ).addTo(carteLeaflet);
      couchePoints = L.layerGroup().addTo(carteLeaflet);
    },

    async chargerMarqueurs() {
      if (!carteLeaflet || !couchePoints) return;
      const params = new URLSearchParams();
      if (this.filtreDep) params.set('departement', this.filtreDep);
      const { prospects } = await boFetch('/prospection/carte' + (params.toString() ? '?' + params : ''));
      couchePoints.clearLayers();
      const points = [];
      prospects.forEach((p) => {
        if (p.lat == null || p.lng == null) return;
        const couleur = COULEURS_STATUT[p.statut] || '#94a3b8';
        const marqueur = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 1, fillColor: couleur, fillOpacity: 0.9 });
        marqueur.bindTooltip(p.nom);
        marqueur.on('click', () => this.ouvrirProspect(p.id));
        marqueur.addTo(couchePoints);
        points.push([p.lat, p.lng]);
      });
      if (points.length) carteLeaflet.fitBounds(points, { padding: [30, 30], maxZoom: 12 });
    },

    async chargerProspects() {
      this.erreurChargement = '';
      const params = new URLSearchParams();
      if (this.filtreStatut) params.set('statut', this.filtreStatut);
      if (this.filtreDep) params.set('departement', this.filtreDep);
      if (this.filtreRecherche) params.set('recherche', this.filtreRecherche);
      if (this.filtreTri && this.filtreTri !== 'nom') params.set('tri', this.filtreTri);
      if (this.filtreInscrits) params.set('inscrits', '1');
      params.set('page', this.pageProspects);
      try {
        const [apercu, liste] = await Promise.all([
          boFetch('/prospection/apercu'),
          boFetch('/prospection/prospects' + (params.toString() ? '?' + params : '')),
        ]);
        this.apProsp = apercu;
        this.prospects = liste.prospects;
        this.totalProspects = liste.total ?? liste.prospects.length;
        this.tailleProspects = liste.taille ?? 100;
        this.totalInscrits = liste.total_inscrits ?? 0;
        this.selectionProspects = {};
        this.lotMsg = '';
      } catch (e) {
        this.erreurChargement = e.message || 'Erreur de chargement des prospects';
      }
    },

    // — Sélection groupée —
    estSelectionne(id) { return !!this.selectionProspects[id]; },
    basculer(id) {
      if (this.selectionProspects[id]) delete this.selectionProspects[id];
      else this.selectionProspects[id] = true;
      this.selectionProspects = { ...this.selectionProspects };
    },
    toutSelectionne() { return this.prospects.length > 0 && this.prospects.every((p) => this.selectionProspects[p.id]); },
    basculerTout() {
      if (this.toutSelectionne()) { this.selectionProspects = {}; return; }
      const s = { ...this.selectionProspects };
      this.prospects.forEach((p) => { s[p.id] = true; });
      this.selectionProspects = s;
    },
    nbSelection() { return Object.keys(this.selectionProspects).length; },

    // Envoi de la sélection traité UN PAR UN en séquence (comme rattraperActivation, dont le
    // pattern est éprouvé) plutôt qu'en un seul gros appel groupé /prospecter-lot : sur une
    // grande série, plusieurs envois lourds partant "en rafale" (ou même un seul appel groupé
    // trop long) saturaient le Worker/Resend (503) et faisaient courir une course sur le
    // rafraîchissement de session (401). Un par un, boFetch gère proprement le rafraîchissement
    // s'il expire en cours de route. Pas de plafond arbitraire à 40.
    // Les échecs (503 compris) sont mémorisés dans lotEchecs plutôt que perdus : le bouton
    // "Relancer les échecs" ne retape QUE ceux-là, jamais ceux déjà envoyés avec succès (voir
    // relancerEchecsLot ci-dessous) — sinon relancer toute la liste enverrait des doublons.
    async envoyerLotParIds(ids) {
      this.lotEnCours = true;
      this.lotMsg = '';
      const prospectsParId = new Map(this.prospects.map((p) => [p.id, p]));
      const echecs = [];
      let envoyes = 0, sansEmail = 0;
      for (let i = 0; i < ids.length; i++) {
        const p = prospectsParId.get(ids[i]);
        this.lotMsg = `${i + 1}/${ids.length}${p ? ' — ' + p.nom : ''}…`;
        try {
          await this.prospecterAvecRetry(ids[i]);
          envoyes += 1;
          if (p) {
            if (p.statut === 'a_contacter') p.statut = 'contacte';
            p.prochaine_relance_le = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
          }
        } catch (e) {
          if (e.status === 422) sansEmail += 1;
          else echecs.push({ id: ids[i], nom: p ? p.nom : ids[i] });
        }
        // Petite pause entre deux envois : laisse respirer le Worker/Resend, évite l'effet de
        // rafale qui causait les 503 quand beaucoup d'envois partaient en même temps.
        if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
      this.lotEchecs = echecs;
      this.lotMsg = `${envoyes} envoyé(s), ${sansEmail} sans email${echecs.length ? `, ${echecs.length} en erreur (voir « Relancer les échecs » ci-dessus)` : ''}.`;
      try { this.apProsp = await boFetch('/prospection/apercu'); } catch {}
      this.lotEnCours = false;
    },
    // Un 503 est presque toujours transitoire (Worker/Resend momentanément saturé) : une seconde
    // tentative après une pause plus longue réussit souvent, sans risquer de double-envoi
    // puisqu'on ne retente QUE si la première tentative a explicitement échoué.
    async prospecterAvecRetry(id) {
      try {
        return await boFetch('/prospection/prospects/' + id + '/prospecter', { method: 'POST' });
      } catch (e) {
        if (e.status !== 503) throw e;
        await new Promise((r) => setTimeout(r, 2000));
        return await boFetch('/prospection/prospects/' + id + '/prospecter', { method: 'POST' });
      }
    },
    async envoyerLot() {
      const ids = Object.keys(this.selectionProspects);
      if (!ids.length) return;
      // Garde-fou : le bouton groupé sert à démarcher des prospects jamais contactés. Si la
      // sélection contient des prospects déjà à un statut ultérieur (contacté, relance, rdv,
      // gagné, perdu), on ne les renvoie pas ici pour ne pas gaspiller un email en double —
      // une relance volontaire d'un prospect déjà contacté passe par « Activer et renvoyer »
      // (rattrapage) ou par le bouton ✉ ligne par ligne, des actions délibérées et ciblées.
      const prospectsParId = new Map(this.prospects.map((p) => [p.id, p]));
      const dejaContactes = ids.filter((id) => prospectsParId.get(id)?.statut !== 'a_contacter');
      const aEnvoyer = ids.filter((id) => !dejaContactes.includes(id));
      this.selectionProspects = {};
      if (!aEnvoyer.length) {
        alert(`Les ${ids.length} prospect(s) sélectionné(s) sont déjà contacté(s) — aucun envoi pour éviter les doublons. Pour relancer volontairement un prospect déjà contacté, utilise le bouton ✉ sur sa ligne, ou « Activer et renvoyer » dans le rattrapage.`);
        return;
      }
      const avertissement = dejaContactes.length ? `\n\n⚠ ${dejaContactes.length} déjà contacté(s) dans la sélection : ignoré(s), pas de renvoi automatique.` : '';
      if (!confirm(`Envoyer la présentation à ${aEnvoyer.length} commune(s) ? Celles qui n'ont pas encore d'espace seront créées à l'instant en version gratuite, avec un compte maire chacune. Traité un par un : ça peut prendre un moment pour une grande liste.${avertissement}`)) return;
      await this.envoyerLotParIds(aEnvoyer);
    },
    async relancerEchecsLot() {
      const ids = this.lotEchecs.map((e) => e.id);
      if (!ids.length) return;
      await this.envoyerLotParIds(ids);
    },

    async appliquerStatutLot() {
      const ids = Object.keys(this.selectionProspects);
      if (!ids.length || !this.statutLotChoisi) return;
      if (!confirm(`Passer ${ids.length} prospect(s) au statut « ${this.libelleStatut(this.statutLotChoisi)} » ?`)) return;
      this.statutLotEnCours = true;
      this.lotMsg = '';
      try {
        const r = await boFetch('/prospection/prospects/statut-lot', {
          method: 'PATCH', body: JSON.stringify({ ids, statut: this.statutLotChoisi }),
        });
        this.lotMsg = `${r.modifies} prospect(s) mis à jour.`;
        this.statutLotChoisi = '';
        this.selectionProspects = {};
        await this.chargerProspects();
      } catch (e) {
        this.lotMsg = e.message || 'Échec';
      } finally {
        this.statutLotEnCours = false;
      }
    },

    // Rattrapage traité un prospect à la fois (un appel /prospecter par prospect, pas un lot
    // groupé côté Worker) : hérite de la fiabilité déjà éprouvée du bouton d'envoi unitaire,
    // sans risque de limite cumulée sur une grosse liste. La barre de progression vient du fait
    // que ça peut prendre un moment si la liste est longue.
    async rattraperActivation() {
      this.rattrapageEnCours = true;
      this.rattrapageMsg = 'Recherche des prospects à rattraper…';
      let candidats;
      try {
        candidats = (await boFetch('/prospection/prospects/candidats-rattrapage')).candidats;
      } catch (e) {
        this.rattrapageMsg = e.message || 'Échec de la recherche';
        this.rattrapageEnCours = false;
        return;
      }
      if (!candidats.length) {
        this.rattrapageMsg = 'Aucun prospect à rattraper.';
        this.rattrapageEnCours = false;
        return;
      }
      if (!confirm(`Activer une commune gratuite et renvoyer la présentation (avec identifiants) à ${candidats.length} prospect(s) déjà contacté(s) ? Traité un par un, ça peut prendre un moment.`)) {
        this.rattrapageMsg = '';
        this.rattrapageEnCours = false;
        return;
      }
      let ok = 0, echecs = 0;
      for (let i = 0; i < candidats.length; i++) {
        const p = candidats[i];
        this.rattrapageMsg = `${i + 1}/${candidats.length} — ${p.nom}…`;
        try {
          await boFetch('/prospection/prospects/' + p.id + '/prospecter', { method: 'POST' });
          ok += 1;
        } catch (e) {
          echecs += 1;
        }
      }
      this.rattrapageMsg = `Terminé : ${ok} activé(s) et renvoyé(s), ${echecs} en échec (email manquant/invalide ou erreur).`;
      await this.chargerProspects();
      try { this.apProsp = await boFetch('/prospection/apercu'); } catch {}
      this.rattrapageEnCours = false;
    },

    async importer() {
      if (!this.importDep.trim()) { this.importMsg = 'Indique un département.'; return; }
      this.importEnCours = true;
      this.importMsg = '';
      try {
        const corps = { departement: this.importDep.trim() };
        if (this.importPopMax) corps.population_max = Number(this.importPopMax);
        const r = await boFetch('/prospection/importer', { method: 'POST', body: JSON.stringify(corps) });
        this.importMsg = `${r.importes} commune(s) importée(s), ${r.deja_presents} déjà présente(s).`;
        await this.chargerProspects();
      } catch (e) {
        this.importMsg = e.message || 'Import impossible';
      } finally {
        this.importEnCours = false;
      }
    },

    // Envoi direct depuis une ligne de la liste (sans ouvrir la fiche). Crée la commune en
    // gratuit si elle n'existe pas encore (voir activerCommuneGratuite côté Worker) : confirmation
    // nécessaire, ce n'est plus un simple envoi d'email.
    async envoyerPresentationLigne(p) {
      if (this.envoiLigneId !== null || this.lotEnCours || this.rattrapageEnCours) return; // évite un envoi concurrent
      this.envoiLigneId = p.id;
      try {
        await boFetch('/prospection/prospects/' + p.id + '/prospecter', { method: 'POST' });
        // Reflète côté liste : statut → contacté (si à contacter) + relance à +7 jours.
        if (p.statut === 'a_contacter') p.statut = 'contacte';
        p.prochaine_relance_le = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
        this.dernierEnvoiId = p.id;
      } catch (e) {
        alert(e.message || 'Envoi impossible');
      } finally {
        this.envoiLigneId = null;
      }
    },

    async ouvrirProspect(id) {
      this.chargement = true;
      this.vue = 'prospect';
      this.prospMsg = '';
      this.conversion = { ouvert: false, enCours: false, succes: false, erreur: '', nom: '', slug: '', maireEmail: '', mairePrenom: '', maireNom: '', mairePassword: '', url: '' };
      try {
        const d = await boFetch('/prospection/prospects/' + id);
        this.prospect = d.prospect;
        this.interactions = d.interactions;
        // Prospect déjà client : on récupère le slug de sa commune pour les liens app/fiche.
        if (this.prospect.commune_id) {
          try {
            const c = await boFetch('/administration/communes/' + this.prospect.commune_id);
            this.conversion.slug = c.commune.slug;
          } catch {}
        }
        // Auto-enrichissement du contact en arrière-plan (sans clic ni blocage de l'affichage).
        if (!this.prospect.enrichi_le && this.prospect.code_insee) {
          boFetch('/prospection/prospects/' + id + '/enrichir', { method: 'POST' })
            .then((r) => { if (this.prospect && this.prospect.id === id) this.prospect = { ...this.prospect, ...r.prospect }; })
            .catch(() => {});
        }
      } finally {
        this.chargement = false;
      }
    },

    async prospecter() {
      if (!confirm('Envoyer la présentation à la mairie ? Si cette commune n\'a pas encore d\'espace, il sera créé à l\'instant en version gratuite, avec un compte maire (identifiants envoyés dans l\'email).')) return;
      this.prospEnCours = true;
      this.prospMsg = '';
      try {
        const r = await boFetch('/prospection/prospects/' + this.prospect.id + '/prospecter', { method: 'POST' });
        this.prospMsg = 'Présentation envoyée à ' + r.email;
        // Recharge la fiche pour refléter le nouveau statut, la relance et l'historique.
        const d = await boFetch('/prospection/prospects/' + this.prospect.id);
        this.prospect = d.prospect;
        this.interactions = d.interactions;
      } catch (e) {
        this.prospMsg = e.message || 'Envoi impossible';
      } finally {
        this.prospEnCours = false;
      }
    },

    slugify(s) {
      return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    },

    ouvrirConversion() {
      this.conversion = {
        ouvert: true, enCours: false, succes: false, erreur: '',
        nom: this.prospect.nom, slug: this.slugify(this.prospect.nom),
        maireEmail: this.prospect.contact_email || '', mairePrenom: '', maireNom: '', mairePassword: '', url: '',
        envoyerEmail: true,
      };
    },

    async convertir() {
      this.conversion.enCours = true;
      this.conversion.erreur = '';
      try {
        const r = await boFetch('/onboarding/creer', {
          method: 'POST',
          body: JSON.stringify({
            prospect_id: this.prospect.id,
            nom: this.conversion.nom,
            slug: this.conversion.slug,
            population: this.prospect.population || null,
            maire: {
              email: this.conversion.maireEmail,
              prenom: this.conversion.mairePrenom,
              nom: this.conversion.maireNom,
              password: this.conversion.mairePassword,
            },
            envoyer_email: this.conversion.envoyerEmail,
          }),
        });
        // On ne touche pas à prospect.commune_id ici : le laisser nul maintient l'affichage du
        // bloc de succès (célébration + liens). Au prochain chargement de la fiche, la commune
        // liée est relue et l'état « déjà cliente » s'affiche normalement.
        this.conversion.succes = true;
        this.conversion.ouvert = false;
        this.conversion.url = r.url;
        this.conversion.slug = r.commune.slug;
        this.prospect.statut = 'gagne';
      } catch (e) {
        this.conversion.erreur = e.message || 'Création impossible';
      } finally {
        this.conversion.enCours = false;
      }
    },

    lienFiche(slug, nom) {
      return '/backoffice/fiche?slug=' + encodeURIComponent(slug) + '&nom=' + encodeURIComponent(nom);
    },

    async enrichir() {
      this.enrichEnCours = true;
      try {
        const r = await boFetch('/prospection/prospects/' + this.prospect.id + '/enrichir', { method: 'POST' });
        this.prospect = { ...this.prospect, ...r.prospect };
      } catch (e) {
        alert(e.message || 'Enrichissement impossible');
      } finally {
        this.enrichEnCours = false;
      }
    },

    async majProspect(patch) {
      try {
        await boFetch('/prospection/prospects/' + this.prospect.id, { method: 'PATCH', body: JSON.stringify(patch) });
        // Un changement de statut ou d'email ajoute une entrée automatique à l'historique : on recharge.
        if (patch.statut !== undefined || patch.contact_email !== undefined) {
          const d = await boFetch('/prospection/prospects/' + this.prospect.id);
          this.prospect.email_invalide = d.prospect.email_invalide;
          this.interactions = d.interactions;
        }
      } catch (e) {
        alert(e.message || 'Mise à jour impossible');
      }
    },
    // Normalise le champ avant envoi : un champ vidé doit être enregistré comme "pas d'email"
    // (null), pas comme une chaîne vide qui échouerait à la validation email côté serveur.
    async corrigerEmailProspect() {
      const valeur = (this.prospect.contact_email || '').trim();
      await this.majProspect({ contact_email: valeur || null });
    },

    async ajouterInteraction() {
      if (!this.nouvInteraction.contenu.trim()) return;
      try {
        const r = await boFetch('/prospection/prospects/' + this.prospect.id + '/interactions', {
          method: 'POST', body: JSON.stringify(this.nouvInteraction),
        });
        this.interactions.unshift(r.interaction);
        this.nouvInteraction = { type: 'note', contenu: '' };
      } catch (e) {
        alert(e.message || 'Ajout impossible');
      }
    },

    // Bouton rapide pour les réponses automatiques « mairie fermée/absente » (vacances, congés,
    // fermeture exceptionnelle) : journalise l'info ET reprogramme la relance en un seul geste,
    // au lieu de devoir ajouter une note puis recalculer la date à la main.
    async confirmerFermeture() {
      this.fermeture.enCours = true;
      try {
        const dateRetour = this.fermeture.dateRetour;
        // Sans date de retour indiquée dans le message, on retente dans 14 jours plutôt que de
        // laisser le prospect sans relance programmée (durée courante d'une fermeture ponctuelle).
        const dateRelance = dateRetour || new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
        const contenu = dateRetour
          ? `Mairie fermée — retour prévu le ${this.formatDate(dateRetour)}`
          : 'Mairie fermée (date de retour non précisée) — relance reprogrammée dans 14 jours';
        const r = await boFetch('/prospection/prospects/' + this.prospect.id + '/interactions', {
          method: 'POST', body: JSON.stringify({ type: 'ferme', contenu }),
        });
        this.interactions.unshift(r.interaction);
        this.prospect.prochaine_relance_le = dateRelance;
        await this.majProspect({ prochaine_relance_le: dateRelance });
        this.fermeture = { ouvert: false, dateRetour: '', enCours: false };
      } catch (e) {
        alert(e.message || 'Ajout impossible');
      } finally {
        this.fermeture.enCours = false;
      }
    },

    async corrigerEmailsInvalides() {
      this.correctionEnCours = true;
      this.correctionMsg = '';
      try {
        const r = await boFetch('/prospection/prospects/corriger-emails-invalides', { method: 'POST' });
        this.correctionMsg = `${r.corriges} email(s) corrigé(s) via l'annuaire, ${r.inchanges} toujours introuvable(s) ou inchangé(s).`;
      } catch (e) {
        this.correctionMsg = e.message || 'Échec';
      } finally {
        this.correctionEnCours = false;
      }
    },

    async envoyerTestPresentation() {
      this.testPresentationEnCours = true;
      this.testPresentationMsg = '';
      try {
        const r = await boFetch('/administration/email-test-presentation', {
          method: 'POST', body: JSON.stringify({ destinataire: this.testEmailDest }),
        });
        this.testPresentationMsg = `Envoyé à ${r.destinataire} (variante « ${r.variante || '—'} »). Ouvre-le et clique le bouton pour tester le suivi.`;
      } catch (e) {
        this.testPresentationMsg = e.message || 'Échec de l\'envoi';
      } finally {
        this.testPresentationEnCours = false;
      }
    },

    // Envoie la variante actuellement OUVERTE DANS L'ÉDITEUR (pas forcément l'active) — pour
    // relire un test avant d'activer une variante en cours de rédaction.
    async envoyerTestVariante() {
      if (!this.varianteEditeeId) return;
      this.testVarianteEnCours = true;
      this.testVarianteMsg = '';
      try {
        const r = await boFetch('/administration/email-test-presentation', {
          method: 'POST',
          body: JSON.stringify({ destinataire: this.testEmailDest, variante_id: this.varianteEditeeId }),
        });
        this.testVarianteMsg = `Envoyé à ${r.destinataire} (variante « ${r.variante || '—'} »).`;
      } catch (e) {
        this.testVarianteMsg = e.message || 'Échec de l\'envoi';
      } finally {
        this.testVarianteEnCours = false;
      }
    },

    // Vue comparaison (colonnes) : stats déjà chargées à l'init (this.statsVariantes),
    // rapprochées par nom de variante — pas de requête supplémentaire.
    statsPourVariante(nom) {
      return this.statsVariantes.find((v) => v.nom === nom) || null;
    },
    ouvrirEditionVariante(id) {
      this.vueVarianteEmail = 'edition';
      this.chargerVariante(id);
    },

    // Troncature réaliste de l'aperçu boîte de réception (n caractères selon mobile/desktop).
    tronquer(txt, n) {
      const t = txt || '';
      return t.length > n ? t.slice(0, n) + '…' : t;
    },

    // Aperçu rendu du corps HTML avec des valeurs d'exemple à la place des variables — même
    // substitution que côté serveur (rendrePresentation dans email-commune.ts), simplifiée
    // puisque c'est un aperçu, pas un envoi réel.
    rendreApercuEmail(corpsHtml) {
      const logo = this.modele.logo_image_url
        ? `<img src="${this.modele.logo_image_url}" style="max-height:56px;max-width:160px;object-fit:contain" alt="" />`
        : '<div style="font-weight:800;color:#2c5f2d;font-size:22px">Plateforme-Agora</div>';
      const signature = this.modele.signature_image_url
        ? `<img src="${this.modele.signature_image_url}" style="width:48px;height:48px;border-radius:50%;object-fit:cover" alt="" />`
        : '';
      return (corpsHtml || '')
        .replace(/\{\{commune\}\}/g, 'Commune Test')
        .replace(/\{\{url\}\}/g, 'https://plateforme-agora.fr/commune-test/')
        .replace(/\{\{lien_fiche\}\}/g, 'https://plateforme-agora.fr/backoffice/fiche?slug=commune-test&nom=Commune+Test')
        .replace(/\{\{logo\}\}/g, logo)
        .replace(/\{\{signature_photo\}\}/g, signature);
    },

    async envoyerEmailTest() {
      this.testEmailEnCours = true;
      this.testEmailMsg = '';
      this.testEmailOk = false;
      try {
        const r = await boFetch('/administration/email-test', {
          method: 'POST', body: JSON.stringify({ destinataire: this.testEmailDest }),
        });
        this.testEmailOk = true;
        this.testEmailMsg = `Email envoyé à ${r.destinataire} (depuis ${r.from}). Vérifie ta boîte de réception et les logs Resend.`;
      } catch (e) {
        this.testEmailMsg = e.message || 'Échec de l\'envoi';
      } finally {
        this.testEmailEnCours = false;
      }
    },

    async deconnexion() {
      try { await boFetch('/auth/logout', { method: 'POST' }); } catch {}
      location.href = '/backoffice/connexion';
    },

    // — Utilitaires d'affichage —
    classeNote(note) {
      if (note >= 4) return 'bo-note--haute';
      if (note >= 2.5) return 'bo-note--moyenne';
      return 'bo-note--basse';
    },
    formatDate(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    },
    formatOctets(o) {
      if (!o) return '0 o';
      const unites = ['o', 'Ko', 'Mo', 'Go'];
      const i = Math.floor(Math.log(o) / Math.log(1024));
      return Math.round((o / Math.pow(1024, i)) * 10) / 10 + ' ' + unites[i];
    },
    formatDateHeure(iso) {
      if (!iso) return '';
      return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    },
    libelleStatut(s) {
      return { a_contacter: 'À contacter', contacte: 'Contacté', relance: 'Relancé', rdv: 'RDV', gagne: 'Gagné', perdu: 'Perdu' }[s] || s;
    },
    libelleType(t) {
      return { note: 'Note', appel: 'Appel', email: 'Email', courrier: 'Courrier', rdv: 'RDV', statut: 'Statut', contact: 'Contact corrigé', ferme: 'Fermé/absent' }[t] || t;
    },
    libelleStatutClient(s) {
      return { active: 'Active', suspendue: 'Suspendue', resiliee: 'Résiliée' }[s] || 'Active';
    },
    toggleTiroir(cle) {
      this.tiroirsOuverts[cle] = !this.tiroirsOuverts[cle];
      localStorage.setItem('bo_tiroirs', JSON.stringify(this.tiroirsOuverts));
    },
    pct(n, total) {
      return total ? `${n} (${Math.round((n / total) * 100)}%)` : String(n);
    },
    periodeEnvoi(v) {
      if (!v.premier_envoi_le) return '—';
      const debut = this.formatDate(v.premier_envoi_le);
      const fin = this.formatDate(v.dernier_envoi_le);
      return debut === fin ? debut : debut + ' → ' + fin;
    },

    // — Palette de recherche globale (Ctrl/Cmd+K) —
    ouvrirPalette() {
      this.paletteOuverte = true;
      this.paletteRecherche = '';
      this.paletteResultats = [];
      this.$nextTick(() => this.$refs.paletteInput && this.$refs.paletteInput.focus());
    },
    fermerPalette() {
      this.paletteOuverte = false;
    },
    async rechercherPalette() {
      const q = this.paletteRecherche.trim();
      if (!q) { this.paletteResultats = []; return; }
      const qMin = q.toLowerCase();
      const communesTrouvees = this.communes
        .filter((c) => c.nom.toLowerCase().includes(qMin))
        .slice(0, 8)
        .map((c) => ({ type: 'commune', id: c.id, nom: c.nom }));

      let prospectsTrouves = [];
      try {
        const r = await boFetch('/prospection/prospects?recherche=' + encodeURIComponent(q));
        prospectsTrouves = r.prospects.slice(0, 8).map((p) => ({ type: 'prospect', id: p.id, nom: p.nom }));
      } catch { /* recherche prospects non bloquante */ }

      // Ignore une réponse arrivée après que la recherche ait changé entre-temps.
      if (this.paletteRecherche.trim() !== q) return;
      this.paletteResultats = [...communesTrouvees, ...prospectsTrouves];
    },
    allerVersResultatPalette(r) {
      this.fermerPalette();
      if (r.type === 'commune') this.ouvrirFiche(r.id);
      else this.ouvrirProspect(r.id);
    },
    genererQr(url) {
      try {
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch { return ''; }
    },
    pctRgpd(n) {
      const p = this.rgpd && this.rgpd.nb_citoyens;
      return p ? ` (${Math.round((n / p) * 100)} %)` : '';
    },

    // — Facturation (suivi des échéances, pas un système de paiement en ligne) —
    libelleOnglet(cle) {
      return LABELS_ONGLET[cle] || cle;
    },

    async enregistrerOngletsGratuits() {
      if (!confirm('Ce périmètre sera appliqué immédiatement à toutes les communes actuellement sur le palier Gratuit. Continuer ?')) return;
      this.ongletsGratuitsEnCours = true;
      this.ongletsGratuitsMsg = '';
      try {
        const r = await boFetch('/administration/onglets-gratuits', {
          method: 'PUT',
          body: JSON.stringify({ onglets: this.ongletsGratuitsSelection }),
        });
        this.ongletsGratuitsMsg = `Enregistré — ${r.nb_communes_mises_a_jour} commune(s) mise(s) à jour.`;
      } catch (e) {
        this.ongletsGratuitsMsg = e.message || 'Échec';
      } finally {
        this.ongletsGratuitsEnCours = false;
      }
    },

    async enregistrerGrille() {
      this.grilleEnCours = true;
      this.grilleMsg = '';
      try {
        await boFetch('/administration/grille-tarifaire', {
          method: 'PUT',
          body: JSON.stringify({
            tranches: this.grilleTarifaire.tranches.map((t) => ({ id: t.id, prix_annuel_ttc: Number(t.prix_annuel_ttc) || 0 })),
            mois_offerts_3ans: Number(this.grilleTarifaire.mois_offerts_3ans) || 0,
          }),
        });
        this.grilleMsg = 'Grille enregistrée.';
      } catch (e) {
        this.grilleMsg = e.message || 'Échec';
      } finally {
        this.grilleEnCours = false;
      }
    },
    async chargerStaff() {
      if (this.staffListe.length) return; // déjà chargé, pas besoin de recharger à chaque ouverture du tiroir
      try {
        this.staffListe = (await boFetch('/administration/staff')).staff;
      } catch (e) {
        this.staffMsg = e.message || 'Échec du chargement';
      }
    },
    async toggleStaffActif(s) {
      const nouveauActif = !s.actif;
      if (!confirm(`${nouveauActif ? 'Réactiver' : 'Désactiver'} le compte de ${s.nom} ?`)) return;
      try {
        await boFetch('/administration/staff/' + s.id, { method: 'PATCH', body: JSON.stringify({ actif: nouveauActif }) });
        s.actif = nouveauActif;
      } catch (e) { alert(e.message || 'Échec'); }
    },
    async reinitialiserMdpStaff(s) {
      if (!confirm(`Générer un nouveau mot de passe provisoire pour ${s.nom} ?`)) return;
      try {
        const r = await boFetch('/administration/staff/' + s.id + '/reinitialiser-mdp', { method: 'POST' });
        this.staffMsg = `Nouveau mot de passe pour ${r.email} : ${r.mot_de_passe} — note-le, il ne sera plus affiché.`;
      } catch (e) { alert(e.message || 'Échec'); }
    },

    async chargerJournal() {
      if (this.journalActivite.length) return;
      try {
        this.journalActivite = (await boFetch('/administration/journal-activite')).entrees;
      } catch {}
    },

    async enregistrerParametresEntreprise() {
      this.parametresEntrepriseEnCours = true;
      this.parametresEntrepriseMsg = '';
      try {
        await boFetch('/administration/parametres-entreprise', {
          method: 'PUT', body: JSON.stringify(this.parametresEntreprise),
        });
        this.parametresEntrepriseMsg = 'Enregistré.';
      } catch (e) {
        this.parametresEntrepriseMsg = e.message || 'Échec';
      } finally {
        this.parametresEntrepriseEnCours = false;
      }
    },
    libelleTranche(t) {
      if (!t) return '';
      return t.population_max == null ? `> ${t.population_min - 1} hab.` : `${t.population_min}–${t.population_max} hab.`;
    },
    trancheSuggeree(population) {
      if (!population || !this.grilleTarifaire.tranches.length) return null;
      return this.grilleTarifaire.tranches.find((t) => population >= t.population_min && (t.population_max == null || population <= t.population_max)) || null;
    },
    joursAvantEcheance(dateStr) {
      if (!dateStr) return null;
      return Math.ceil((new Date(dateStr) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
    },
    // Badge de santé d'une commune (tableau Communes clientes) : 🔴 attention requise
    // (statut non actif, email de contact rejeté, ou échéance dépassée), 🟡 échéance proche
    // (60 jours), 🟢 rien à signaler. Ne combine que des signaux déjà présents dans la liste,
    // sans requête supplémentaire par commune.
    santeCommune(c) {
      if (c.statut_client && c.statut_client !== 'active') {
        return { icone: '🔴', titre: 'Statut : ' + this.libelleStatutClient(c.statut_client) };
      }
      if (c.email_invalide) {
        return { icone: '🔴', titre: 'Email de contact rejeté (bounce) — à corriger' };
      }
      const j = this.joursAvantEcheance(c.prochaine_echeance);
      if (j !== null && j <= 0) {
        return { icone: '🔴', titre: 'Échéance dépassée le ' + this.formatDate(c.prochaine_echeance) };
      }
      if (j !== null && j <= 60) {
        return { icone: '🟡', titre: 'Échéance dans ' + j + ' j (' + this.formatDate(c.prochaine_echeance) + ')' };
      }
      return { icone: '🟢', titre: 'Rien à signaler' };
    },
    // Rang numérique du badge de santé, pour le tri (🔴 en premier = ce qui demande le plus
    // d'attention en tête de liste en tri ascendant).
    rangSante(c) {
      const icone = this.santeCommune(c).icone;
      return icone === '🔴' ? 0 : icone === '🟡' ? 1 : 2;
    },
    // Tri du tableau Communes clientes : clic sur un en-tête = trie par cette colonne (ré-clic =
    // inverse le sens). Client-side, la liste est déjà entièrement chargée.
    trierPar(cle) {
      if (this.triCommunes.cle === cle) {
        this.triCommunes.sens = this.triCommunes.sens === 'asc' ? 'desc' : 'asc';
      } else {
        this.triCommunes = { cle, sens: 'asc' };
      }
      this.pageCommunes = 1; // un nouveau tri repart de la première page
    },
    flecheTri(cle) {
      if (this.triCommunes.cle !== cle) return '';
      return this.triCommunes.sens === 'asc' ? ' ▲' : ' ▼';
    },
    communesTriees() {
      const { cle, sens } = this.triCommunes;
      if (!cle) return this.communes;
      const valeur = (c) => {
        if (cle === 'sante') return this.rangSante(c);
        if (cle === 'statut_client') return this.libelleStatutClient(c.statut_client);
        return c[cle];
      };
      const copie = [...this.communes];
      copie.sort((a, b) => {
        let va = valeur(a), vb = valeur(b);
        // Valeurs manquantes toujours en fin de liste, quel que soit le sens.
        const videA = va === null || va === undefined || va === '';
        const videB = vb === null || vb === undefined || vb === '';
        if (videA && videB) return 0;
        if (videA) return 1;
        if (videB) return -1;
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return sens === 'asc' ? cmp : -cmp;
      });
      return copie;
    },
    // Pagination du tableau (côté client : le tri porte sur des champs calculés comme
    // "santé", donc plus simple de trier/paginer la liste déjà chargée que de tout refaire
    // porter par le serveur). 100 par page, même taille que la liste des prospects.
    nbPagesCommunes() {
      return Math.max(1, Math.ceil(this.communesTriees().length / 100));
    },
    allerPageCommunes(delta) {
      const cible = Math.min(this.nbPagesCommunes(), Math.max(1, this.pageCommunes + delta));
      this.pageCommunes = cible;
    },
    communesPage() {
      const debut = (this.pageCommunes - 1) * 100;
      return this.communesTriees().slice(debut, debut + 100);
    },
    classeEcheance(dateStr) {
      const j = this.joursAvantEcheance(dateStr);
      if (j === null) return '';
      return j <= 0 ? 'bo-note--basse' : j <= 60 ? 'bo-note--moyenne' : '';
    },
    appliquerTarifSuggere() {
      const t = this.trancheSuggeree(this.fiche.commune.population);
      if (!t) return;
      const prixBase = Number(t.prix_annuel_ttc) || 0;
      if (Number(this.fiche.commune.duree_engagement_mois) === 36) {
        const moisPayes = 36 - (Number(this.grilleTarifaire.mois_offerts_3ans) || 0);
        this.fiche.commune.prix_annuel_ttc = Math.round((prixBase / 12) * moisPayes);
      } else {
        this.fiche.commune.prix_annuel_ttc = prixBase;
      }
    },
    async enregistrerAbonnement() {
      this.abonnementEnCours = true;
      this.abonnementMsg = '';
      try {
        await boFetch('/administration/communes/' + this.fiche.commune.id + '/abonnement', {
          method: 'PATCH',
          body: JSON.stringify({
            prix_annuel_ttc: this.fiche.commune.prix_annuel_ttc === '' || this.fiche.commune.prix_annuel_ttc == null ? null : Number(this.fiche.commune.prix_annuel_ttc),
            duree_engagement_mois: Number(this.fiche.commune.duree_engagement_mois) || 12,
            prochaine_echeance: this.fiche.commune.prochaine_echeance || null,
          }),
        });
        this.abonnementMsg = 'Enregistré.';
      } catch (e) {
        this.abonnementMsg = e.message || 'Échec';
      } finally {
        this.abonnementEnCours = false;
      }
    },
    async marquerAbonnementPaye() {
      if (!confirm('Marquer cette échéance comme payée et avancer à la prochaine ?')) return;
      this.abonnementEnCours = true;
      this.abonnementMsg = '';
      try {
        const r = await boFetch('/administration/communes/' + this.fiche.commune.id + '/abonnement/marquer-paye', { method: 'POST' });
        this.fiche.commune.prochaine_echeance = r.prochaine_echeance;
        this.abonnementMsg = 'Payé — prochaine échéance : ' + this.formatDate(r.prochaine_echeance);
      } catch (e) {
        this.abonnementMsg = e.message || 'Échec';
      } finally {
        this.abonnementEnCours = false;
      }
    },

    // — Devis & facturation —
    async chargerDevisFactures(communeId) {
      const [d, f] = await Promise.all([
        boFetch('/administration/devis?commune_id=' + communeId),
        boFetch('/administration/factures?commune_id=' + communeId),
      ]);
      this.devisListe = d.devis;
      this.facturesListe = f.factures;
    },
    async creerDevis() {
      this.devisEnCours = true;
      this.devisMsg = '';
      try {
        await boFetch('/administration/devis', {
          method: 'POST',
          body: JSON.stringify({ ...this.nouveauDevis, commune_id: this.fiche.commune.id, nom_destinataire: this.fiche.commune.nom }),
        });
        this.nouveauDevis = { objet: '', montant_ht: '', taux_tva: 0, duree_engagement_mois: 12, validite_jours: 30 };
        await this.chargerDevisFactures(this.fiche.commune.id);
        this.devisMsg = 'Devis créé.';
      } catch (e) {
        this.devisMsg = e.message || 'Échec';
      } finally {
        this.devisEnCours = false;
      }
    },
    async changerStatutDevis(d) {
      try {
        await boFetch('/administration/devis/' + d.id, { method: 'PATCH', body: JSON.stringify({ statut: d.statut }) });
      } catch (e) { alert(e.message || 'Échec'); }
    },
    async enregistrerBonCommande(d) {
      const reference = prompt('Référence du bon de commande (optionnel) :') || null;
      try {
        await boFetch('/administration/devis/' + d.id, {
          method: 'PATCH',
          body: JSON.stringify({ bon_commande_recu_le: new Date().toISOString(), bon_commande_reference: reference }),
        });
        await this.chargerDevisFactures(this.fiche.commune.id);
      } catch (e) { alert(e.message || 'Échec'); }
    },
    async genererFacture(d) {
      if (!confirm(`Générer la facture pour le devis ${d.numero} ?`)) return;
      try {
        await boFetch('/administration/devis/' + d.id + '/facturer', { method: 'POST' });
        await this.chargerDevisFactures(this.fiche.commune.id);
        this.devisMsg = 'Facture générée.';
      } catch (e) { alert(e.message || 'Échec'); }
    },
    async changerStatutFacture(f) {
      try {
        await boFetch('/administration/factures/' + f.id, { method: 'PATCH', body: JSON.stringify({ statut: f.statut }) });
      } catch (e) { alert(e.message || 'Échec'); }
    },

    // — Gestion des utilisateurs d'une commune —
    libelleRole(r) {
      return { citoyen: 'Citoyen', admin: 'Admin', elu: 'Élu', maire: 'Maire', superadmin: 'Superadmin' }[r] || r;
    },

    async ouvrirUtilisateurs() {
      this.communeActiveId = this.fiche.commune.id;
      this.communeActiveNom = this.fiche.commune.nom;
      this.vue = 'utilisateurs';
      this.pageUtilisateurs = 1;
      this.formUtilisateurOuvert = false;
      this.msgUtilisateurs = '';
      await this.chargerUtilisateurs();
    },

    async chargerUtilisateurs() {
      this.erreurChargement = '';
      const params = new URLSearchParams();
      if (this.filtreUtilisateurRole) params.set('role', this.filtreUtilisateurRole);
      if (this.filtreUtilisateurRecherche) params.set('recherche', this.filtreUtilisateurRecherche);
      params.set('page', this.pageUtilisateurs);
      try {
        const r = await boFetch('/administration/communes/' + this.communeActiveId + '/utilisateurs?' + params);
        this.utilisateurs = r.utilisateurs;
        this.totalUtilisateurs = r.total;
        this.tailleUtilisateurs = r.taille;
      } catch (e) {
        this.erreurChargement = e.message || 'Erreur de chargement des utilisateurs';
      }
    },

    appliquerFiltresUtilisateurs() {
      this.pageUtilisateurs = 1;
      this.chargerUtilisateurs();
    },
    nbPagesUtilisateurs() {
      return Math.max(1, Math.ceil(this.totalUtilisateurs / this.tailleUtilisateurs));
    },
    allerPageUtilisateurs(delta) {
      const cible = Math.min(this.nbPagesUtilisateurs(), Math.max(1, this.pageUtilisateurs + delta));
      if (cible === this.pageUtilisateurs) return;
      this.pageUtilisateurs = cible;
      this.chargerUtilisateurs();
    },

    basculerFormUtilisateur() {
      this.formUtilisateurOuvert = !this.formUtilisateurOuvert;
      this.nouvelUtilisateur = { nom: '', prenom: '', email: '', role: 'citoyen', password: '' };
      this.msgUtilisateurs = '';
    },

    async creerUtilisateur() {
      this.utilisateurEnCours = true;
      this.msgUtilisateurs = '';
      try {
        await boFetch('/administration/communes/' + this.communeActiveId + '/utilisateurs', {
          method: 'POST', body: JSON.stringify(this.nouvelUtilisateur),
        });
        this.formUtilisateurOuvert = false;
        await this.chargerUtilisateurs();
        await this.rafraichirCompteursCommune();
      } catch (e) {
        this.msgUtilisateurs = e.message || 'Création impossible';
      } finally {
        this.utilisateurEnCours = false;
      }
    },

    ouvrirUtilisateur(u) {
      this.utilisateurEdite = { ...u };
      this.resetMdpResultat = '';
      this.msgUtilisateurs = '';
      this.vue = 'utilisateur';
    },

    async enregistrerUtilisateur() {
      this.utilisateurEnCours = true;
      this.msgUtilisateurs = '';
      try {
        await boFetch('/administration/communes/' + this.communeActiveId + '/utilisateurs/' + this.utilisateurEdite.id, {
          method: 'PATCH',
          body: JSON.stringify({
            nom: this.utilisateurEdite.nom, prenom: this.utilisateurEdite.prenom,
            email: this.utilisateurEdite.email, role: this.utilisateurEdite.role,
          }),
        });
        this.msgUtilisateurs = 'Enregistré.';
        await this.chargerUtilisateurs();
        await this.rafraichirCompteursCommune();
      } catch (e) {
        this.msgUtilisateurs = e.message || 'Échec';
      } finally {
        this.utilisateurEnCours = false;
      }
    },

    // L'enregistrement se fait bien côté serveur (voir PATCH .../utilisateurs/:id), mais rien
    // ne rafraîchissait jusqu'ici la fiche ni le tableau "Communes clientes" affichés à l'écran
    // (chargés une fois à l'ouverture) : après un changement de rôle, l'ancien total restait
    // visible partout — au point de ressembler à un enregistrement qui a échoué (constaté le
    // 2026-08-19). Recalcule localement à partir de fiche.citoyens.par_role, sans re-fetch coûteux
    // de la liste complète des ~5000 communes.
    async rafraichirCompteursCommune() {
      try {
        this.fiche = await boFetch('/administration/communes/' + this.communeActiveId);
        const parRole = this.fiche.citoyens.par_role || {};
        const c = this.communes.find((x) => x.id === this.communeActiveId);
        if (c) {
          c.nb_citoyens = this.fiche.citoyens.total; // citoyen + admin + elu, déjà calculé côté serveur
          c.nb_admin = parRole.admin ?? 0;
          c.nb_elu = parRole.elu ?? 0;
        }
      } catch { /* purement cosmétique : ne doit jamais bloquer le retour à l'utilisateur */ }
    },

    async reinitialiserMdpUtilisateur() {
      if (!confirm('Régénérer un mot de passe temporaire pour ce compte ?')) return;
      this.utilisateurEnCours = true;
      this.resetMdpResultat = '';
      try {
        const r = await boFetch('/administration/communes/' + this.communeActiveId + '/utilisateurs/' + this.utilisateurEdite.id + '/reinitialiser-mdp', { method: 'POST' });
        this.resetMdpResultat = r.email + ' : ' + r.mot_de_passe;
      } catch (e) {
        this.msgUtilisateurs = e.message || 'Échec';
      } finally {
        this.utilisateurEnCours = false;
      }
    },

    async supprimerUtilisateur() {
      if (!confirm('Supprimer (anonymiser) ce compte ? Cette action est irréversible.')) return;
      this.utilisateurEnCours = true;
      try {
        await boFetch('/administration/communes/' + this.communeActiveId + '/utilisateurs/' + this.utilisateurEdite.id, { method: 'DELETE' });
        this.vue = 'utilisateurs';
        await this.chargerUtilisateurs();
        await this.rafraichirCompteursCommune();
      } catch (e) {
        this.msgUtilisateurs = e.message || 'Échec';
      } finally {
        this.utilisateurEnCours = false;
      }
    },
    pctPop(n) {
      const p = this.frequentation && this.frequentation.population;
      return p ? ` (${Math.round((n / p) * 100)} %)` : '';
    },
    maxFreq() {
      if (!this.frequentation || !this.frequentation.serie.length) return 1;
      return Math.max(1, ...this.frequentation.serie.map((s) => s.count));
    },
    relanceEnRetard(p) {
      if (!p.prochaine_relance_le || p.statut === 'gagne' || p.statut === 'perdu') return false;
      return p.prochaine_relance_le <= new Date().toISOString().slice(0, 10);
    },
  };
}

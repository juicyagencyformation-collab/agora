// frontend/backoffice/js/app.js — logique Alpine du tableau de bord backoffice.
function backoffice() {
  return {
    vue: 'communes',      // 'communes' | 'fiche'
    chargement: true,
    staff: { nom: '' },
    apercu: {},
    communes: [],
    fiche: null,
    coordsEnCours: false,
    coordsMsg: '',
    accesEnCours: false,
    accesMsg: '',
    forfaitNom: '',
    forfaitQuota: '',
    forfaitEnCours: false,
    forfaitMsg: '',
    presentEnCours: false,
    presentMsg: '',
    modele: { objet: '', corps_html: '', signature_image_url: null },
    modeleEnCours: false,
    modeleMsg: '',
    signatureEnCours: false,
    signatureMsg: '',
    testEmailDest: '',
    testEmailEnCours: false,
    testEmailMsg: '',
    testEmailOk: false,

    // — Prospection —
    statuts: ['a_contacter', 'contacte', 'relance', 'rdv', 'gagne', 'perdu'],
    typesInteraction: ['note', 'appel', 'email', 'courrier', 'rdv'],
    prospects: [],
    apProsp: {},
    selectionProspects: {}, // id -> true
    lotEnCours: false,
    lotMsg: '',
    filtreStatut: '',
    filtreDep: '',
    filtreRecherche: '',
    filtreTri: 'nom',
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
    conversion: { ouvert: false, enCours: false, succes: false, erreur: '', nom: '', slug: '', maireEmail: '', mairePrenom: '', maireNom: '', mairePassword: '', url: '' },

    async init() {
      try {
        const { staff } = await boFetch('/auth/me');
        this.staff = staff;
        this.testEmailDest = staff.email || '';
        try { this.modele = (await boFetch('/administration/modele-email')).modele; } catch {}
      } catch {
        redirigerVersConnexion();
        return;
      }
      await this.chargerCommunes();
    },

    async chargerCommunes() {
      this.chargement = true;
      try {
        const [apercu, liste] = await Promise.all([
          boFetch('/administration/apercu'),
          boFetch('/administration/communes'),
        ]);
        this.apercu = apercu;
        this.communes = liste.communes;
      } finally {
        this.chargement = false;
      }
    },

    async ouvrirFiche(id) {
      this.chargement = true;
      this.vue = 'fiche';
      this.coordsMsg = '';
      this.accesMsg = '';
      this.forfaitMsg = '';
      this.presentMsg = '';
      try {
        this.fiche = await boFetch('/administration/communes/' + id);
        this.forfaitNom = this.fiche.commune.forfait || '';
        this.forfaitQuota = this.fiche.commune.quota_go ?? '';
        if (!this.fiche.commune.statut_client) this.fiche.commune.statut_client = 'active';
      } finally {
        this.chargement = false;
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

    async enregistrerModele() {
      this.modeleEnCours = true;
      this.modeleMsg = '';
      try {
        await boFetch('/administration/modele-email', {
          method: 'PUT', body: JSON.stringify({ objet: this.modele.objet, corps_html: this.modele.corps_html }),
        });
        this.modeleMsg = 'Modèle enregistré.';
      } catch (e) {
        this.modeleMsg = e.message || 'Échec';
      } finally {
        this.modeleEnCours = false;
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

    async renvoyerAcces() {
      if (!confirm('Régénérer un mot de passe temporaire et renvoyer l\'email au maire ?')) return;
      this.accesEnCours = true;
      this.accesMsg = '';
      try {
        const r = await boFetch('/administration/communes/' + this.fiche.commune.id + '/renvoyer-acces', { method: 'POST' });
        this.accesMsg = 'Accès renvoyés à ' + r.email;
      } catch (e) {
        this.accesMsg = e.message || 'Envoi impossible';
      } finally {
        this.accesEnCours = false;
      }
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

    // — Prospection —
    async allerProspection() {
      this.vue = 'prospection';
      this.prospect = null;
      await this.chargerProspects();
    },

    async chargerProspects() {
      const params = new URLSearchParams();
      if (this.filtreStatut) params.set('statut', this.filtreStatut);
      if (this.filtreDep) params.set('departement', this.filtreDep);
      if (this.filtreRecherche) params.set('recherche', this.filtreRecherche);
      if (this.filtreTri && this.filtreTri !== 'nom') params.set('tri', this.filtreTri);
      const [apercu, liste] = await Promise.all([
        boFetch('/prospection/apercu'),
        boFetch('/prospection/prospects' + (params.toString() ? '?' + params : '')),
      ]);
      this.apProsp = apercu;
      this.prospects = liste.prospects;
      this.selectionProspects = {};
      this.lotMsg = '';
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

    async envoyerLot() {
      const ids = Object.keys(this.selectionProspects);
      if (!ids.length) return;
      if (ids.length > 40) { this.lotMsg = 'Maximum 40 communes par envoi.'; return; }
      if (!confirm(`Envoyer la présentation à ${ids.length} commune(s) ?`)) return;
      this.lotEnCours = true;
      this.lotMsg = '';
      try {
        const r = await boFetch('/prospection/prospecter-lot', { method: 'POST', body: JSON.stringify({ ids }) });
        this.lotMsg = `${r.envoyes} envoyé(s), ${r.sans_email} sans email, ${r.ignores} ignoré(s).`;
        await this.chargerProspects();
        this.lotMsg = `${r.envoyes} envoyé(s), ${r.sans_email} sans email, ${r.ignores} ignoré(s).`;
      } catch (e) {
        this.lotMsg = e.message || 'Envoi impossible';
      } finally {
        this.lotEnCours = false;
      }
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
      if (!confirm('Envoyer l\'email de présentation à la mairie et marquer la commune comme contactée ?')) return;
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
        // Un changement de statut ajoute une entrée automatique à l'historique : on recharge.
        if (patch.statut !== undefined) {
          const d = await boFetch('/prospection/prospects/' + this.prospect.id);
          this.interactions = d.interactions;
        }
      } catch (e) {
        alert(e.message || 'Mise à jour impossible');
      }
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
      return { note: 'Note', appel: 'Appel', email: 'Email', courrier: 'Courrier', rdv: 'RDV', statut: 'Statut' }[t] || t;
    },
    libelleStatutClient(s) {
      return { active: 'Active', suspendue: 'Suspendue', resiliee: 'Résiliée' }[s] || 'Active';
    },
    relanceEnRetard(p) {
      if (!p.prochaine_relance_le || p.statut === 'gagne' || p.statut === 'perdu') return false;
      return p.prochaine_relance_le <= new Date().toISOString().slice(0, 10);
    },
  };
}

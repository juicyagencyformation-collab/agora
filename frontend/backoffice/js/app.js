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
    testEmailDest: '',
    testEmailEnCours: false,
    testEmailMsg: '',
    testEmailOk: false,

    // — Prospection —
    statuts: ['a_contacter', 'contacte', 'relance', 'rdv', 'gagne', 'perdu'],
    typesInteraction: ['note', 'appel', 'email', 'courrier', 'rdv'],
    prospects: [],
    apProsp: {},
    filtreStatut: '',
    filtreDep: '',
    filtreRecherche: '',
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
      try {
        this.fiche = await boFetch('/administration/communes/' + id);
      } finally {
        this.chargement = false;
      }
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
      const [apercu, liste] = await Promise.all([
        boFetch('/prospection/apercu'),
        boFetch('/prospection/prospects' + (params.toString() ? '?' + params : '')),
      ]);
      this.apProsp = apercu;
      this.prospects = liste.prospects;
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
    relanceEnRetard(p) {
      if (!p.prochaine_relance_le || p.statut === 'gagne' || p.statut === 'perdu') return false;
      return p.prochaine_relance_le <= new Date().toISOString().slice(0, 10);
    },
  };
}

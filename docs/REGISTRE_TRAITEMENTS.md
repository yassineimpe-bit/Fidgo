# Registre des activités de traitement — Retiko (art. 30 RGPD)

> **Document de travail établi à partir du code** (`main` du 25/09/2026, après
> #127 et la migration 022). Ce n'est pas un avis juridique. Les bases légales
> et durées marquées **à valider** doivent être confirmées par le responsable de
> traitement ; les informations d'identité manquantes sont listées en un seul
> endroit dans `lib/legal.ts` et `docs/LEGAL_STATUS.md`.

Retiko tient deux registres :

- **Partie A** : traitements dont Retiko est **responsable** (relation SaaS avec les commerçants) ;
- **Partie B** : traitements réalisés **pour le compte des commerces** (programme de fidélité), Retiko étant **sous-traitant** ; chaque commerce tient son propre registre de responsable.

## Identification

| Rubrique | Valeur |
|---|---|
| Responsable (A) / sous-traitant (B) | Éditeur de Retiko — identité **[À COMPLÉTER]** (`lib/legal.ts`) |
| Représentant légal | **[À COMPLÉTER]** |
| Contact données personnelles | **[À COMPLÉTER]** |
| DPO | **[À COMPLÉTER]** (désignation à décider) |
| Dernière mise à jour | 25/09/2026 |

---

## Partie A — Retiko responsable de traitement

### A1. Comptes commerçants et équipes

| Rubrique | Contenu |
|---|---|
| Finalités | Création de l'espace commerçant, vérification de l'adresse e-mail, authentification, gestion des rôles (OWNER, MANAGER, EMPLOYEE, VIEWER), onboarding guidé |
| Personnes | Propriétaires, gérants, employés des commerces |
| Données | E-mail, empreinte bcrypt du mot de passe, rôle, état actif, `token_version`, date de vérification e-mail ; informations publiques du commerce (nom, adresse, téléphone, Instagram, site, logo, couleur) |
| Base légale | Exécution du contrat — *à valider* |
| Destinataires | Retiko ; sous-traitants : Vercel, Neon, GitHub (sauvegardes), Resend (e-mails de vérification et de réinitialisation) |
| Durée | Durée du contrat. Clôture : accès coupés, données conservées sans anonymisation — **à décider** |
| Sécurité | Liens de vérification 256 bits stockés en SHA-256, 24 h, usage unique ; réinscription d'une adresse non vérifiée qui remplace le secret et invalide les anciens liens ; sessions révocables |

### A2. Acceptation des conditions et prospection Retiko

| Rubrique | Contenu |
|---|---|
| Finalités | Preuve de l'acceptation des CGU/CGV ; envoi des nouveautés Retiko aux commerçants qui l'ont demandé |
| Données | `legal_acceptances` (document, version, date, source `signup`, commerce, compte) ; `staff_users.marketing_consent` et sa date |
| Base légale | Preuve : exécution du contrat / intérêt légitime — *à valider*. Prospection : consentement (case non pré-cochée, facultative) |
| Durée | Preuve : **à décider** (durée du contrat + prescription). Consentement : jusqu'à retrait |
| Remarque | Aucun envoi marketing n'est implémenté à ce jour ; chaque membre d'équipe modifie ou retire son choix dans la page *Sécurité* |

### A3. Sécurité, traçabilité et prévention des abus

| Rubrique | Contenu |
|---|---|
| Finalités | Journal des actions sensibles, limitation des tentatives, réinitialisation de mot de passe, diagnostic d'incident |
| Données | `audit_logs` (acteur, action, entité, métadonnées filtrées) ; `rate_limits` (empreinte SHA-256 de l'IP ou de l'e-mail, compteur) ; tokens de réinitialisation et de vérification (empreintes) ; erreurs navigateur (type, message tronqué, chemin expurgé, user-agent) ; journaux Vercel |
| Base légale | Intérêt légitime (sécurité du service) — *à valider* |
| Durée | Voir `DATA_LIFECYCLE.md` : `audit_logs` 730 j et tokens J+30 **prévus, non actifs** ; `rate_limits` 48 h via cron Vercel (exécution non vérifiée) ; journaux Vercel **à documenter** |

### A4. Facturation

| Rubrique | Contenu |
|---|---|
| Finalités | Période pilote, abonnement, suivi des paiements |
| Données | Offre, statut, dates d'essai et de période ; identifiants client/abonnement Stripe ; e-mail et adresse de facturation saisis chez Stripe |
| Base légale | Exécution du contrat ; obligations comptables — *à valider* |
| Sous-traitant | Stripe — **désactivé en production** (`STRIPE_ENABLED=false`) |
| Durée | Aucune purge ; durée comptable **à décider** |

### A5. Mesure produit

| Rubrique | Contenu |
|---|---|
| Finalités | Performance du scanner, fiabilité caméra, adoption du parcours |
| Données | `product_events` (type, durée, identifiants pseudonymes carte/staff) ; mesures de scan stockées uniquement sur l'appareil du commerce (200 dernières : durées, résultat, origine QR/saisie, horodatage), exportables manuellement depuis `/s/stats` pour le gate terrain, sans token ni donnée client |
| Base légale | Intérêt légitime — *à valider* (qualification responsable / sous-traitant à confirmer pour les événements liés aux cartes) |
| Durée | 180 j **prévus, non actifs** ; lien carte retiré à l'effacement d'un client |

### A6. Sauvegardes et restauration

| Rubrique | Contenu |
|---|---|
| Finalités | Continuité de service, restauration après incident |
| Données | Copie logique complète de la base (parties A et B) |
| Traitement | Workflow GitHub Actions quotidien (`database-backup.yml`) : accès temporaire par broker OIDC, `pg_dump` **en clair sur un runner GitHub éphémère** le temps du job, restauration de contrôle et `db:verify` sur une base jetable, chiffrement CMS AES-256 avec le certificat public Retiko, suppression du dump en clair avant l'upload |
| Destinataires | GitHub (exécution, stockage des artefacts chiffrés) ; clé privée de déchiffrement hors dépôt |
| Durée | Artefacts chiffrés : 14 jours (**appliquée**) |

### A7. Administration de la plateforme

| Rubrique | Contenu |
|---|---|
| Finalités | Supervision, suspension réversible d'un commerce, traçabilité des accès opérateur |
| Données | `platform_admins` ; `platform_admin_audit` (administrateur, action, cible, motif, date) |
| Base légale | Intérêt légitime — *à valider* |
| Durée | Journal append-only sans purge — **à décider** |

---

## Partie B — Retiko sous-traitant pour le compte des commerces

| Rubrique | Contenu |
|---|---|
| Responsables | Chaque commerce utilisateur |
| Traitements | Inscription au programme (page `/j/[commerce]`), carte web / PWA, crédits, récompenses et corrections, récupération de carte par e-mail (si activée), cartes Apple / Google Wallet (si activées), notes internes, export et effacement |
| Personnes | Clients finaux des commerces |
| Données | E-mail (obligatoire), prénom et téléphone (facultatifs), consentement marketing du commerce et sa date, note interne (≤ 500 caractères, visible du commerce seul) ; carte (token opaque, code court, solde, dates) ; ledger ; état Wallet ; empreintes des liens de récupération ; événements scanner pseudonymisés |
| Données exclues | Aucune donnée sensible ; aucune donnée de contact dans le QR ; tokens absents des URL de suivi et des journaux |
| Information des personnes | Mention sur la page d'inscription avec lien vers la politique de confidentialité ; le commerce reste tenu d'informer ses clients |
| Durée | Jusqu'à l'effacement demandé au commerce ; clients **inactifs : aucune durée — à décider** ; ledger conservé pseudonymisé après effacement — **à décider** |
| Droits | Export JSON, rectification des coordonnées, retrait du consentement marketing et effacement dans le dashboard (OWNER/MANAGER) ; limitation : traitement manuel (voir `RGPD_PROCEDURES.md`) |

---

## Sous-traitants ultérieurs

« Actif » = utilisé en production aujourd'hui ; « si activé » = derrière un interrupteur désactivé ou non vérifié. Aucune garantie contractuelle (DPA signé, clauses types, localisation) n'est affirmée ici tant qu'elle n'a pas été vérifiée dans les contrats.

| Prestataire | Service | Données | Statut | Localisation / transfert |
|---|---|---|---|---|
| Vercel | Hébergement applicatif, journaux d'exécution, cron | Toutes les données en transit ; journaux filtrés | Actif | Calcul en région `fra1` (`vercel.json`) ; société américaine — **garanties à documenter** |
| Neon | PostgreSQL | Toutes les données stockées | Actif | Région **à confirmer dans la console** |
| GitHub (Actions) | Sauvegardes, restauration de contrôle, monitoring, CI | Dump complet **en clair sur le runner pendant le job** ; artefacts chiffrés 14 j | Actif | Société américaine — **garanties à documenter** |
| Resend | E-mails transactionnels | E-mail du destinataire, nom du commerce, lien à usage unique | Actif (vérification e-mail obligatoire depuis #127) | Domaine d'envoi `retiko.fr`, région `eu-west-1` déclarée par l'exploitant — **garanties à documenter** |
| Stripe | Paiement des abonnements | E-mail et adresse de facturation, identifiants Stripe | Si activé (désactivé en production) | **À documenter** |
| Google | Google Wallet | Prénom (20 car.), nom du commerce, solde, QR | Si activé | Société américaine — **garanties à documenter** |
| Apple | Notifications APNs des passes | Push token de l'appareil, identifiant du pass | Si activé | Société américaine — **garanties à documenter** |

---

## Mesures de sécurité (art. 32) vérifiables dans le dépôt

- isolation par commerce garantie en base (clés étrangères composites « same tenant », y compris pour `legal_acceptances`) ;
- mots de passe bcrypt ; tokens de vérification, de réinitialisation et de récupération stockés en SHA-256, à usage unique ;
- sessions HttpOnly révocables immédiatement (`token_version`), rôles vérifiés côté serveur ;
- protection d'origine sur les mutations, limitation de débit, CSP avec nonce, en-têtes `no-store` / `no-referrer` sur les pages portant un secret ;
- ledger append-only, interdiction des suppressions physiques sur commerces, clients et cartes ;
- tests adversariaux (XSS, fixation de session, JWT falsifié, isolation tenant) dans la CI ;
- sauvegardes chiffrées avec restauration testée quotidiennement.

Ces mesures sont vérifiées dans le code et la CI ; leur effectivité en production dépend de la configuration de l'environnement.

---

## Écarts ouverts

| # | Écart | Nature |
|---|---|---|
| E1 | Aucune durée pour les **clients inactifs** | Décision de durée, puis mécanisme d'anonymisation |
| E2 | Purge data lifecycle **non exécutée en production** (secret `DATABASE_URL` absent de l'environnement GitHub `production`, `DATA_LIFECYCLE_EXECUTE` non activé) | Correctif d'exploitation + validation des durées |
| E3 | Commerce clos et staff désactivé conservés sans anonymisation définitive | Durée à fixer (contraintes comptables incluses) |
| E4 | Transferts hors UE (Vercel, GitHub, Resend, Stripe, Google, Apple) : garanties non documentées | Documentation contractuelle |
| E5 | Identité juridique, contact données personnelles, DPO | À compléter |
| E6 | Rétention des journaux Vercel non documentée | À documenter |
| E7 | ~~Pas d'outil de rectification des coordonnées client ni de retrait isolé du consentement marketing client~~ | **Résolu** : outillé sur la fiche client ; reste la limitation (manuelle) et la modification de l'e-mail de connexion commerçant |
| E8 | Durée de conservation des preuves d'acceptation, de `platform_admin_audit` et des données de facturation | À décider |

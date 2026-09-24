# Registre des activités de traitement — Retiko (art. 30 RGPD)

> **Projet de travail établi à partir du code** (`main` au 24/09/2026), pas un
> avis juridique. Les bases légales, durées et garanties de transfert marquées
> « à valider » doivent être confirmées par le responsable de traitement avant
> le premier client payant. Les champs `[à compléter]` dépendent de l'identité
> juridique de Retiko (voir mentions légales).

Retiko tient deux registres distincts :

- **Partie A** : traitements dont Retiko est **responsable** (relation SaaS avec les commerçants) ;
- **Partie B** : traitements réalisés **pour le compte des commerces** (programme de fidélité), Retiko étant **sous-traitant** ; chaque commerce tient son propre registre de responsable.

## Identification

| Rubrique | Valeur |
|---|---|
| Responsable (partie A) / sous-traitant (partie B) | Retiko — `[raison sociale, forme, SIREN, siège]` |
| Représentant légal | `[à compléter]` |
| Contact RGPD | `[adresse dédiée, ex. rgpd@…]` |
| DPO | `[désigné / non désigné — à décider]` |
| Dernière mise à jour | 24/09/2026 |

---

## Partie A — Retiko responsable de traitement (art. 30.1)

### A1. Comptes commerçants et équipes

| Rubrique | Contenu |
|---|---|
| Finalités | Création et gestion des espaces commerçants, authentification, gestion des rôles (propriétaire, manager, employé, lecture seule) |
| Personnes concernées | Propriétaires, managers, employés des commerces |
| Données | Email, empreinte bcrypt du mot de passe, rôle, état actif, version de session, dates ; coordonnées publiques du commerce (nom, adresse, téléphone, Instagram, site, logo) |
| Base légale | Exécution du contrat SaaS — *à valider* |
| Destinataires | Retiko (équipe habilitée) ; sous-traitants : Vercel, Neon, GitHub (sauvegardes) |
| Durée | Tant que le compte est actif. Fermeture : accès coupés, données conservées ; **anonymisation définitive non définie** (voir écart E3) |

### A2. Sécurité, traçabilité et prévention des abus

| Rubrique | Contenu |
|---|---|
| Finalités | Journal des actions sensibles, limitation des tentatives, réinitialisation de mot de passe, diagnostic d'incident |
| Données | `audit_logs` (acteur, action, entité, métadonnées filtrées) ; `rate_limits` (empreinte SHA-256 irréversible de l'IP ou de l'email, compteur) ; `password_reset_tokens` (empreinte du lien, expiration) ; journaux Vercel (route normalisée, code d'erreur, user-agent — jamais de mot de passe, JWT, token de carte, lien magique ni email) |
| Base légale | Intérêt légitime (sécurité du service) — *à valider* |
| Durée | `audit_logs` 730 jours (proposée) ; `rate_limits` 2 jours ; jetons de réinitialisation 30 jours après usage ou expiration ; journaux Vercel selon la rétention du plan Vercel `[à documenter]` |

### A3. Facturation

| Rubrique | Contenu |
|---|---|
| Finalités | Essai, abonnement, suivi des paiements |
| Données | Offre, statut, dates d'essai et de période ; identifiants Stripe ; email du propriétaire transmis à Stripe Checkout |
| Base légale | Exécution du contrat ; obligations comptables — *à valider* |
| Sous-traitant | Stripe (**désactivé par défaut**, `STRIPE_ENABLED=false`) |
| Durée | Non purgée automatiquement ; durée comptable légale à confirmer |

### A4. Mesure produit

| Rubrique | Contenu |
|---|---|
| Finalités | Performance du scanner, fiabilité de la caméra, adoption du parcours |
| Données | `product_events` : type d'événement, durée, identifiants pseudonymes carte/staff, métadonnées bornées ; métriques API (route, statut, durée) |
| Base légale | Intérêt légitime — *à valider* (qualification responsable / sous-traitant à confirmer pour les événements liés aux cartes clients) |
| Durée | 180 jours (proposée) ; lien carte retiré à l'effacement d'un client |

### A5. Sauvegardes et restauration

| Rubrique | Contenu |
|---|---|
| Finalités | Continuité de service, restauration après incident |
| Données | Copie logique complète de la base (toutes les données des parties A et B) |
| Traitement | Workflow GitHub Actions quotidien : `pg_dump` **en clair sur un runner éphémère** le temps du job, restauration de contrôle dans une base jetable, puis chiffrement CMS AES-256 avec le certificat public Retiko ; le dump en clair est supprimé avant l'upload |
| Destinataires | GitHub (exécution et stockage des artefacts chiffrés) ; la clé privée de déchiffrement est conservée hors dépôt |
| Durée | Artefacts chiffrés : 14 jours |

### A6. Administration de la plateforme (à l'intégration de la PR super-admin)

| Rubrique | Contenu |
|---|---|
| Finalités | Supervision, suspension réversible d'un commerce, traçabilité des accès opérateur |
| Données | `platform_admin_audit` : email et identifiant de l'administrateur, action, cible, motif, date |
| Durée | Journal append-only, sans purge automatique — *durée à fixer* |

---

## Partie B — Retiko sous-traitant pour le compte des commerces (art. 30.2)

| Rubrique | Contenu |
|---|---|
| Responsables de traitement | Chaque commerce utilisateur (liste tenue dans la base `establishments`) |
| Catégories de traitements | Inscription au programme de fidélité ; carte web / PWA ; crédits, récompenses et corrections ; récupération de carte par email ; cartes Apple / Google Wallet ; notes internes du commerce ; export et effacement sur demande |
| Personnes concernées | Clients finaux des commerces |
| Données | Email (obligatoire en V0), prénom et téléphone (facultatifs), consentement marketing et sa date, note interne (≤ 500 caractères, visible du commerce seul) ; carte : token opaque, code court, solde, dates ; ledger des transactions ; état des passes Wallet ; empreintes des liens de récupération ; événements scanner pseudonymisés |
| Données exclues | Aucune donnée sensible (art. 9) ; aucune donnée de contact dans le QR ; pas de token dans les URL de suivi ni dans les journaux |
| Durée | Pendant la relation commerce ; effacement ou anonymisation sur instruction ; **durée d'inactivité d'un client non définie** (écart E1) ; ledger conservé pseudonymisé après effacement (intégrité, antifraude) |
| Droits des personnes | Export JSON (`GET /api/customers/:id/export`) et effacement (`DELETE /api/customers/:id`) disponibles pour le commerce ; procédure dans `RGPD_PROCEDURES.md` |

---

## Sous-traitants ultérieurs

Liste unique, établie depuis le code. « Actif » = utilisé en production dès le déploiement ; « si activé » = derrière un interrupteur d'environnement désactivé par défaut.

| Prestataire | Service | Données traitées | Statut | Localisation / transfert |
|---|---|---|---|---|
| Vercel | Hébergement applicatif, journaux d'exécution | Toutes les données en transit ; journaux filtrés | Actif | Fonctions en région `fra1` (Francfort) ; société américaine — garanties `[à documenter]` |
| Neon | Base PostgreSQL | Toutes les données stockées | Actif | Région UE configurée `[à confirmer dans la console]` |
| GitHub (Actions) | Sauvegardes quotidiennes, restauration de contrôle, surveillance de disponibilité | Dump complet **en clair sur le runner pendant le job** ; artefacts chiffrés 14 jours | Actif | Société américaine — garanties `[à documenter]` |
| Resend | Emails transactionnels (récupération de carte, réinitialisation de mot de passe) | Email du destinataire, nom du commerce, lien à usage unique | Si activé (`RESEND_API_KEY`, `CARD_RECOVERY_ENABLED`) | `[à documenter]` |
| Stripe | Paiement des abonnements | Email du propriétaire, identifiant du commerce, données de paiement saisies chez Stripe | Si activé (`STRIPE_ENABLED`) | `[à documenter]` |
| Google (Google Wallet) | Carte de fidélité dans Google Wallet | Prénom (20 caractères), nom du commerce, solde, QR de la carte | Si activé (`GOOGLE_WALLET_ENABLED`) | Société américaine — garanties `[à documenter]` |
| Apple (APNs) | Notification de mise à jour des passes Apple Wallet | Push token de l'appareil, identifiant du pass | Si activé (`APPLE_WALLET_ENABLED`) | Société américaine — garanties `[à documenter]` |

Un prestataire « si activé » ne doit être présenté comme sous-traitant effectif qu'à partir de son activation en production.

---

## Mesures de sécurité (art. 32) — synthèse

- Isolation par commerce garantie en base (clés étrangères composites, contraintes anti cross-tenant) ;
- mots de passe bcrypt, sessions révocables immédiatement (`token_version`), rôles vérifiés côté serveur ;
- protection d'origine sur les mutations, limitation de débit, CSP avec nonce ;
- ledger append-only, interdiction des suppressions physiques sur commerces, clients et cartes ;
- tokens, liens magiques, secrets et emails exclus des journaux ;
- sauvegardes chiffrées, restauration testée quotidiennement ;
- surveillance de disponibilité externe et runbook d'incident (`INCIDENT_RUNBOOK.md`).

---

## Écarts ouverts (décisions du responsable de traitement)

| # | Écart | Nature |
|---|---|---|
| E1 | Aucune durée de conservation des **clients inactifs** : une carte jamais réutilisée reste identifiante indéfiniment | Décision de durée, puis mécanisme d'anonymisation à développer |
| E2 | Durées de purge proposées (`product_events` 180 j, `audit_logs` 730 j…) mais exécution automatique désactivée (`DATA_LIFECYCLE_EXECUTE`) | Validation des durées |
| E3 | Commerce fermé : données du commerce et de son équipe conservées sans anonymisation définitive | Durée à fixer (contraintes comptables incluses), puis procédure |
| E4 | Transferts hors UE (Vercel, GitHub, Resend, Stripe, Google, Apple) : garanties non documentées | Documentation contractuelle |
| E5 | Identité juridique, contact RGPD, DPO | À compléter |
| E6 | Journaux Vercel : rétention dépendante du plan, non documentée | À documenter |

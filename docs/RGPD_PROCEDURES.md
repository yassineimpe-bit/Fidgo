# Procédures RGPD opérationnelles — pilote Retiko

Ce document décrit les gestes à appliquer pendant le pilote. Il complète `RGPD.md` et le modèle de DPA.

## 1. Demande d’exercice de droits d’un client du Commerce

### Qualification

Pour les données du programme de fidélité, le Commerce est responsable du traitement et Retiko agit comme sous-traitant.

Si une personne contacte directement Retiko :

1. identifier le Commerce concerné avec le minimum d’informations nécessaires ;
2. vérifier raisonnablement l’identité du demandeur sans exiger systématiquement une pièce d’identité ;
3. enregistrer la date de réception et le type de demande ;
4. transmettre la demande au Commerce concerné sans délai indu ;
5. assister le Commerce techniquement pour l’accès, l’export, la rectification ou l’effacement ;
6. tracer la clôture de la demande.

Le Commerce doit répondre à la personne dans les meilleurs délais et, en principe, au plus tard **dans un délai d’un mois** à compter de la réception. Le délai peut être prolongé de deux mois lorsque la demande est complexe ou nombreuse, à condition d’en informer la personne dans le premier mois.

### Canal et contenu de la demande

- **Client d'un programme** : s'adresse au commerce (responsable). S'il écrit à Retiko, appliquer la qualification ci-dessus.
- **Commerçant ou membre d'équipe** : écrit au contact données personnelles de Retiko — **[À COMPLÉTER]** dans `lib/legal.ts` (à défaut, `contact@retiko.fr`, adresse de réponse des e-mails transactionnels).
- Informations minimales à demander : commerce concerné, e-mail utilisé pour la carte ou le compte, nature de la demande. Ne jamais demander de mot de passe ni de lien reçu par e-mail.

### Ce que le produit permet réellement (vérifié dans le code le 25/09/2026)

| Droit | Client fidélité (Retiko sous-traitant) | Commerçant / staff (Retiko responsable) |
|---|---|---|
| Accès / portabilité | **Outil** : export JSON complet (`GET /api/customers/:id/export`, OWNER/MANAGER, 20/h, tracé `CUSTOMER_EXPORT`) — profil, carte sans token, opérations, états Wallet, récupérations, événements, audits | Pas d'export dédié : consultation dans le dashboard, export CSV des opérations ; extraction complète **manuelle** sur demande |
| Rectification | **Outil** : prénom, e-mail et téléphone rectifiables sur la fiche client (`PATCH /api/customers/:id`, OWNER/MANAGER, 60/h, tracé `CUSTOMER_CONTACT_UPDATED` avec les seuls noms de champs) ; unicité e-mail/téléphone par commerce ; carte Google Wallet resynchronisée si le prénom change. Note interne modifiable | Informations du commerce modifiables dans les réglages ; changement de mot de passe en libre-service ; e-mail de connexion **non modifiable** → manuel |
| Effacement | **Outil** : `DELETE /api/customers/:id` — coordonnées supprimées, carte désactivée et identifiants remplacés, liens et Wallet révoqués, ledger conservé sans identité (voir `DATA_LIFECYCLE.md`) | Désactivation d'un membre d'équipe (sessions coupées, données conservées) ; fermeture du commerce (`/api/restaurant/suspend`) ; **pas d'anonymisation définitive** (écart E3) |
| Opposition / retrait du consentement marketing | Aucune campagne n'est envoyée aujourd'hui. **Outils** : bouton « Retirer le consentement marketing » sur la fiche client (tracé `CUSTOMER_MARKETING_WITHDRAWN`) ; **libre-service client** : case « Offres par e-mail » sur sa carte (`PATCH /api/card/<token>/marketing`, `source: customer_card`) et lien de désabonnement signé `/unsubscribe/<jeton>` destiné aux futurs e-mails (un GET ne désabonne jamais ; POST idempotent compatible RFC 8058 ; `source: unsubscribe_link`). Le commerce peut seulement retirer : un consentement ne peut être donné que par le client lui-même (inscription ou sa carte), et exige une adresse e-mail | **Libre-service** : case « nouveautés Retiko » dans *Sécurité* (`PATCH /api/account/marketing`), activable et révocable, datée, tracée `STAFF_MARKETING_CONSENT_UPDATED` |
| Limitation | Pas d'outil ; à traiter manuellement au cas par cas (désactivation de la carte sans effacement) | Pas d'outil ; manuel |

Toute opération manuelle en base : requête ciblée sur l'identifiant et le commerce, dans une transaction, avec une entrée `audit_logs` décrivant l'action (sans donnée personnelle dans le motif). Ne jamais promettre publiquement une fonction absente de ce tableau.

### Délais

Répondre au plus tard un mois après réception ; prolongation de deux mois possible pour une demande complexe ou nombreuse, en informant la personne dans le premier mois. Conserver la date de réception, la décision et la date de clôture.

## 2. Violation de données personnelles

### Détection et première réponse

Dès qu’un incident peut avoir touché des données personnelles :

1. noter l’heure de détection ;
2. limiter l’incident sans détruire les preuves utiles ;
3. identifier les systèmes, commerces et catégories de données potentiellement concernés ;
4. suspendre les accès ou clés compromis si nécessaire ;
5. conserver les journaux utiles ;
6. ouvrir une fiche d’incident.

### Qualification minimale

Documenter :

- la nature de l’incident ;
- la cause connue ou supposée ;
- les catégories de personnes concernées ;
- les catégories de données concernées ;
- le volume approximatif ;
- la durée d’exposition ;
- les conséquences plausibles ;
- les mesures immédiates prises ;
- les commerces affectés.

### Notification aux Commerces

Si l’incident affecte des données traitées pour un Commerce, Retiko informe ce Commerce **sans délai indu** après en avoir pris connaissance.

L’information initiale peut être complétée par étapes à mesure que l’enquête progresse. Elle doit permettre au Commerce d’évaluer ses propres obligations de notification.

### CNIL et personnes concernées

Le Commerce, en tant que responsable du traitement pour son programme, décide si la violation présente un risque pour les droits et libertés des personnes.

- toute violation doit être documentée en interne ;
- lorsqu’elle présente un risque, la notification à la CNIL doit intervenir dans les meilleurs délais et, si possible, dans les **72 heures** après en avoir pris connaissance ;
- lorsqu’elle présente un risque élevé, les personnes concernées doivent également être informées dans les meilleurs délais, sauf exception légale.

Retiko fournit au Commerce les informations techniques dont il dispose pour cette évaluation.

## 3. Registre minimal des incidents

Pour chaque incident de sécurité ou violation potentielle, conserver :

- identifiant interne ;
- date/heure de détection ;
- personne ayant signalé ;
- systèmes concernés ;
- commerces concernés ;
- données concernées ;
- niveau de risque estimé ;
- mesures de confinement ;
- heure d’information des commerces ;
- décision de notification CNIL prise par le responsable de traitement ;
- date de clôture ;
- actions correctives.

Ne jamais copier dans le registre un mot de passe, une clé API, un JWT, un token de carte brut ou un lien magique.

## 4. Fin de relation avec un Commerce

Avant la fermeture effective :

1. confirmer la date de fin et le préavis applicable ;
2. permettre au Commerce d’exporter les données nécessaires ;
3. informer le Commerce de l’état des cartes et soldes fidélité encore ouverts ;
4. appliquer ses instructions de restitution, suppression ou pseudonymisation ;
5. désactiver les accès du personnel ;
6. révoquer les sessions ;
7. planifier la suppression des secrets propres au Commerce s’il en existe ;
8. documenter les données résiduelles justifiées et leur durée de conservation.

Les sauvegardes résiduelles suivent leur cycle de rétention normal et ne doivent pas être restaurées ou réutilisées sauf besoin de reprise ou obligation légitime.

## 5. Sous-traitants

Avant activation d’un nouveau prestataire qui traite des données personnelles :

1. documenter le service rendu ;
2. vérifier le cadre contractuel de protection des données ;
3. documenter la localisation des traitements et les éventuels transferts ;
4. vérifier les paramètres de minimisation des logs ;
5. mettre à jour la liste des sous-traitants ;
6. informer les Commerces lorsqu’une information ou possibilité d’objection est requise.

## 6. Journalisation et observabilité

Les outils de logs et d’observabilité ne doivent pas recevoir volontairement :

- mots de passe ;
- secrets ou clés API ;
- JWT ;
- tokens de carte bruts ;
- liens magiques de récupération ;
- corps de requêtes contenant des données personnelles non nécessaires.

Les événements produit utilisent des identifiants internes et des métriques agrégables plutôt que des coordonnées personnelles.

## 7. Références de contrôle

À relire avant le premier pilote réel :

- CNIL, rôle du responsable de traitement et du sous-traitant ;
- CNIL, clauses de sous-traitance au titre de l’article 28 du RGPD ;
- CNIL, règles de notification des violations de données ;
- CNIL, délais applicables à l’exercice des droits.

Le présent document est une procédure interne de préparation et ne remplace pas une validation juridique des documents contractuels définitifs.

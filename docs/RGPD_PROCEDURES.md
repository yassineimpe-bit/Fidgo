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

### Données disponibles dans le MVP

- export client via la fonction prévue dans le dashboard ;
- effacement/anonymisation via la fonction prévue dans le dashboard ;
- désactivation de la carte liée au client effacé ;
- conservation limitée du ledger pseudonymisé lorsque nécessaire à l’intégrité et à l’antifraude.

Toute demande qui dépasse les capacités du dashboard doit être traitée manuellement avec traçabilité.

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

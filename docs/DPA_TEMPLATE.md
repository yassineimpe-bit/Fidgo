# Annexe de sous-traitance RGPD (DPA) — modèle Retiko

> Modèle de travail à compléter et valider avant signature. Il encadre les traitements effectués par Retiko pour le compte du Commerce dans le cadre du programme de fidélité.

## 1. Parties et qualification

Le **Commerce** agit comme responsable du traitement pour les données de ses clients utilisées dans son programme de fidélité.

**Retiko** agit comme sous-traitant pour ces traitements.

Retiko reste responsable de traitement pour ses finalités propres distinctes, notamment la gestion de ses comptes professionnels, la sécurité du service, le support et la facturation lorsqu’elle est activée.

## 2. Objet et durée du traitement

Retiko est autorisé à traiter, pour le compte du Commerce, les données strictement nécessaires à la fourniture du service de fidélité digitale pendant la durée du contrat et pendant la période technique nécessaire à la restitution, suppression ou pseudonymisation des données après sa fin.

## 3. Nature et finalités des opérations

Les opérations peuvent comprendre :

- collecte via formulaire d’inscription ;
- enregistrement et hébergement ;
- consultation par les utilisateurs autorisés du Commerce ;
- création et affichage d’une carte de fidélité ;
- calcul du solde de points ou tampons ;
- crédit, débit, ajustement et historique d’opérations ;
- récupération sécurisée d’une carte par email lorsque cette fonction est activée ;
- export et effacement des données selon les fonctions prévues ;
- journalisation de sécurité et d’audit ;
- mesures techniques et produit nécessaires au fonctionnement et à l’évaluation du service.

Les finalités sont limitées à la fourniture, la sécurité, le support et l’amélioration opérationnelle du programme de fidélité commandé par le Commerce.

## 4. Catégories de personnes concernées

- clients et prospects du Commerce qui s’inscrivent au programme de fidélité ;
- personnel du Commerce lorsque ses données sont nécessaires à la traçabilité des opérations.

## 5. Catégories de données traitées

Selon les fonctions activées :

- email client, obligatoire en V0 pour la récupération de carte ;
- prénom, facultatif ;
- téléphone, facultatif ;
- consentement marketing et date/état associé ;
- identifiant interne de client ;
- token technique et code court de carte ;
- solde de points ou tampons ;
- historique des opérations et récompenses ;
- identifiants internes des employés ayant réalisé certaines opérations ;
- données techniques minimales de sécurité, journalisation et performance.

Les mots de passe sont stockés sous forme de hash. Les JWT, secrets, tokens de carte bruts et liens magiques ne doivent pas être intégrés volontairement aux outils d’analytics ou d’observabilité.

## 6. Instructions documentées

Retiko ne traite les données que sur instruction documentée du Commerce, telle qu’elle résulte du contrat, des réglages configurés par le Commerce et des demandes écrites compatibles avec le service.

Si Retiko estime qu’une instruction constitue une violation du RGPD ou d’une autre règle applicable en matière de protection des données, Retiko en informe le Commerce dans les meilleurs délais avant de l’exécuter, sauf interdiction légale.

## 7. Confidentialité

Retiko veille à ce que les personnes autorisées à traiter les données :

- n’y accèdent que pour les besoins de leur mission ;
- soient soumises à une obligation appropriée de confidentialité ;
- appliquent les procédures de sécurité prévues pour le service.

## 8. Sécurité

Retiko met en œuvre des mesures techniques et organisationnelles proportionnées au risque, notamment selon l’état du produit :

- séparation logique par établissement ;
- contrôles d’autorisation par rôle ;
- sessions révocables ;
- transport HTTPS en production ;
- secrets hors dépôt Git ;
- mots de passe hashés ;
- idempotence des opérations sensibles ;
- cooldown et audit des overrides ;
- journal d’audit ;
- limitation de débit ;
- sauvegarde et mécanismes de résilience fournis par l’infrastructure utilisée ;
- tests automatisés, y compris l’isolation multi-tenant ;
- limitation des données présentes dans les logs et événements produit.

La liste réelle des mesures doit rester cohérente avec la version déployée.

## 9. Sous-traitants ultérieurs

Le Commerce autorise Retiko à recourir aux sous-traitants techniques nécessaires au service, sous réserve que Retiko :

- tienne une liste à jour des prestataires effectivement activés ;
- impose à ces prestataires des obligations appropriées de protection des données ;
- informe le Commerce d’un changement significatif permettant à celui-ci de formuler une objection motivée lorsque le droit applicable l’exige.

Liste initiale à compléter avant signature :

| Prestataire | Service | Localisation / transfert | Statut pilote |
| --- | --- | --- | --- |
| Vercel | Hébergement applicatif | [à documenter] | Actif |
| Neon | Base PostgreSQL | Région UE configurée | Actif |
| Resend | Email transactionnel | [à documenter] | À activer |
| [Observabilité] | Erreurs / performance | [à documenter] | [statut] |

Un prestataire non activé ne doit pas être présenté comme sous-traitant effectif.

## 10. Assistance pour les droits des personnes

Le Commerce reste responsable de la réponse aux demandes de ses clients.

Retiko assiste le Commerce, dans la mesure raisonnablement nécessaire, pour permettre l’accès, la rectification, l’export, la limitation ou l’effacement des données traitées pour son compte.

Lorsqu’une personne contacte directement Retiko au sujet d’un programme géré par un Commerce, Retiko transmet la demande au Commerce concerné sans décider à sa place du bien-fondé juridique de la demande, sauf lorsqu’il s’agit d’un traitement pour lequel Retiko est lui-même responsable.

## 11. Violations de données personnelles

Retiko documente les incidents susceptibles de constituer une violation de données personnelles.

Lorsqu’une violation affecte des données traitées pour le compte du Commerce, Retiko informe le Commerce **sans délai indu** après en avoir pris connaissance et lui communique, à mesure qu’elles deviennent disponibles, les informations utiles concernant :

- la nature de la violation ;
- les catégories et volumes approximatifs de personnes et données concernées ;
- les conséquences probables ;
- les mesures prises ou proposées pour y remédier et en limiter les effets.

Le Commerce, en tant que responsable du traitement, reste chargé d’évaluer les obligations de notification à la CNIL et, le cas échéant, d’information des personnes concernées.

## 12. Analyse d’impact et consultation de l’autorité

Retiko fournit au Commerce les informations raisonnablement disponibles nécessaires à une analyse d’impact ou à une consultation préalable lorsque le traitement concerné l’exige.

## 13. Restitution, suppression et fin de contrat

À la fin du service, selon les instructions du Commerce et les obligations applicables, Retiko restitue, supprime ou pseudonymise les données personnelles traitées pour son compte.

Les éléments strictement nécessaires à la sécurité, à la preuve d’opérations ou à l’intégrité du ledger peuvent être conservés sous une forme limitée ou pseudonymisée lorsque cela est justifié et documenté.

Les sauvegardes techniques résiduelles suivent leur cycle normal de rétention et ne sont pas réutilisées à d’autres fins.

## 14. Audit et démonstration de conformité

Retiko met à disposition les informations raisonnablement nécessaires pour démontrer le respect de ses obligations de sous-traitant.

Les audits demandés par le Commerce doivent être proportionnés, planifiés avec un préavis raisonnable et organisés de manière à ne pas compromettre la sécurité d’autres clients, les secrets d’affaires ou la disponibilité du service.

## 15. Transferts hors Espace économique européen

Tout transfert de données hors Espace économique européen doit reposer sur un mécanisme juridique valable et être documenté dans la liste des sous-traitants ou la documentation de conformité.

## 16. Contacts

**Responsable du traitement / Commerce**  
Contact RGPD : [nom / email]

**Sous-traitant / Retiko**  
Contact RGPD / sécurité : [nom / email]

## 17. Signatures

Cette annexe fait partie intégrante de l’accord pilote ou du contrat principal.

**Pour Retiko**  
Nom :  
Qualité :  
Date / signature :

**Pour le Commerce**  
Nom :  
Qualité :  
Date / signature :

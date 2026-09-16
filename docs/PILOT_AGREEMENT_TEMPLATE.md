# Accord pilote Retiko — modèle de travail

> Modèle à compléter avec l’identité juridique des parties avant signature. Il doit être relu et adapté au commerce concerné.

## 1. Parties

Entre :

- **Retiko** : [raison sociale / nom], [forme], [SIREN], [adresse], représenté par [nom], ci-après « Retiko » ;
- **Le Commerce** : [raison sociale / enseigne], [forme], [SIREN], [adresse], représenté par [nom], ci-après « le Commerce ».

## 2. Objet du pilote

Retiko met à disposition du Commerce, à titre pilote, un service de fidélité digitale permettant notamment :

- la création d’un programme à tampons ou à points ;
- l’inscription de clients via QR code ;
- l’affichage d’une carte de fidélité web ;
- le scan, le crédit et la consommation de récompenses par le personnel autorisé ;
- l’accès aux fonctions de gestion nécessaires au pilote.

Le pilote a pour finalité d’évaluer l’usage réel du produit en conditions de service et de recueillir des retours techniques et opérationnels.

## 3. Durée et gratuité

Le pilote initial dure **30 jours** à compter du [date de début] et est fourni gratuitement.

À l’issue des 30 jours, le programme ne s’arrête pas automatiquement. Il continue de fonctionner gratuitement jusqu’à décision explicite de l’une des deux parties.

Chaque partie peut décider de mettre fin à cette continuité moyennant un **préavis de 15 jours**, afin de permettre au Commerce d’informer ses clients et de traiter les soldes de fidélité en cours.

Cette continuité ne crée ni engagement commercial à durée indéterminée ni garantie de disponibilité.

## 4. Engagements du Commerce

Le Commerce s’engage à :

- désigner au moins un référent pilote ;
- définir ses plages de service critiques ;
- utiliser les accès Retiko uniquement pour son établissement ;
- informer son personnel du fonctionnement du scanner et de la procédure incident ;
- fournir chaque semaine le nombre de tickets de caisse ou une donnée équivalente permettant de calculer le ratio `scans fidélité / tickets` ;
- signaler les incidents ou anomalies utiles à l’évaluation du pilote ;
- informer ses clients du traitement de leurs données conformément à ses obligations de responsable de traitement.

## 5. Engagements de Retiko

Retiko s’engage à :

- fournir l’accès au service pendant la durée du pilote ;
- appliquer les mesures techniques et organisationnelles prévues pour le MVP ;
- maintenir l’isolation logique entre commerces ;
- journaliser les opérations sensibles nécessaires à la sécurité et à la traçabilité ;
- assister le Commerce pour les demandes d’exercice des droits liées aux données traitées pour son compte ;
- informer le Commerce sans délai indu d’une violation de données personnelles affectant son périmètre ;
- permettre l’export et/ou l’effacement des données prévues par le produit, sous réserve des données devant être conservées ou pseudonymisées pour l’intégrité du ledger et la sécurité.

## 6. Support et incidents

Le pilote ne comporte pas de SLA contractuel.

Pour les incidents bloquants pendant une plage de service critique, Retiko vise un premier accusé de prise en charge dans un délai interne de **30 minutes** lorsque le signalement est reçu et exploitable. Cet objectif constitue un indicateur opérationnel et non une garantie de disponibilité.

En cas d’indisponibilité pendant le service, le Commerce suit la procédure suivante :

1. ne pas ralentir la file ;
2. noter le code court du client et l’opération attendue ;
3. poursuivre le service ;
4. régulariser ensuite via une opération manuelle auditée avec motif obligatoire.

## 7. Données personnelles et rôles RGPD

Pour les données des consommateurs traitées dans le cadre du programme de fidélité :

- le **Commerce** agit comme responsable du traitement ;
- **Retiko** agit comme sous-traitant pour le compte du Commerce.

Retiko agit comme responsable de traitement pour ses propres finalités liées à la relation SaaS, à la sécurité, au support et, lorsqu’elle sera activée, à la facturation.

Les obligations de sous-traitance sont détaillées dans l’annexe `DPA_TEMPLATE.md`, à compléter et signer avec le présent accord.

## 8. Sous-traitants techniques

La liste des sous-traitants effectivement utilisés pour le pilote est tenue à jour. Elle peut notamment comprendre :

- Vercel pour l’hébergement applicatif ;
- Neon pour PostgreSQL ;
- Resend pour les emails transactionnels de récupération, une fois activé ;
- tout outil d’observabilité activé en production.

Aucun fournisseur non activé ne doit être présenté comme sous-traitant effectif.

## 9. Données de mesure du pilote

Retiko peut mesurer les événements techniques et produit nécessaires à l’évaluation du pilote, notamment :

- consultation de la page d’inscription ;
- création de carte ;
- scans réussis ou échoués ;
- crédits réussis ;
- récompenses consommées ;
- temps de traitement du scanner.

Ces événements ne doivent pas contenir de mot de passe, JWT, token de carte brut, lien magique ou email complet non nécessaire.

## 10. Propriété et retours

Chaque partie conserve la propriété de ses éléments préexistants.

Retiko conserve la propriété du logiciel, de son architecture et de ses développements. Le Commerce reste propriétaire de ses données et de ses éléments de marque.

Les retours fonctionnels, suggestions et observations recueillis pendant le pilote peuvent être utilisés par Retiko pour améliorer le produit, sans divulguer d’informations confidentielles propres au Commerce.

## 11. Confidentialité

Chaque partie s’engage à ne pas divulguer les informations non publiques reçues de l’autre partie dans le cadre du pilote, sauf obligation légale ou nécessité liée à l’exécution du service.

Les identifiants, clés, secrets et accès techniques doivent rester confidentiels.

## 12. Fin du pilote

À la fin effective du service, les parties conviennent du traitement des données encore présentes : export, restitution, suppression ou pseudonymisation selon leur nature et les obligations applicables.

Le Commerce reste responsable d’informer ses clients des conséquences de l’arrêt de son programme de fidélité et du traitement des avantages encore en cours.

## 13. Responsabilité et disponibilité

Le pilote est fourni pour évaluation en conditions réelles. Retiko ne garantit pas une disponibilité continue ni l’absence totale d’anomalies pendant cette phase.

Cette clause ne limite pas les obligations légales impératives applicables, notamment en matière de protection des données, sécurité, faute lourde ou dolosive.

## 14. Droit applicable

Le présent accord est soumis au droit français.

En cas de difficulté, les parties cherchent d’abord une résolution amiable. À défaut, la juridiction compétente est déterminée selon les règles légales applicables et la qualité des parties.

## 15. Signatures

Fait à [lieu], le [date], en deux exemplaires ou par signature électronique.

**Pour Retiko**  
Nom :  
Qualité :  
Signature :

**Pour le Commerce**  
Nom :  
Qualité :  
Signature :

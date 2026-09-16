# Accord pilote Retiko — modèle

> Modèle de travail. À faire relire par un avocat avant signature. Reprend les décisions déjà actées dans `SPEC-V0.md` (§21) et `docs/PILOT.md` : ne pas modifier les durées/préavis ici sans les répercuter dans ces documents.

Entre :

- **Retiko**, [forme juridique, SIREN, adresse] (ci-après « Retiko ») ;
- **[Nom du commerce]**, [forme juridique, SIREN, adresse] (ci-après « le Commerce ») ;

## 1. Objet

Le présent accord encadre l'utilisation à titre pilote de la plateforme de fidélité digitale Retiko par le Commerce, du [date de début] pendant une durée initiale de **30 jours**.

## 2. Prix

Le pilote est **gratuit** pendant sa durée initiale de 30 jours.

## 3. Continuité après le jour 30 (« Jour 31 »)

À l'issue des 30 jours, le programme **ne s'arrête pas automatiquement**. Il continue de fonctionner gratuitement jusqu'à décision explicite de l'une des deux parties d'y mettre fin. Cette continuité ne constitue ni un engagement commercial à durée indéterminée, ni une garantie de disponibilité : elle vise uniquement à éviter de rendre inutilisables du jour au lendemain les cartes de fidélité déjà distribuées aux clients du Commerce.

## 4. Conditions de fin

Toute partie peut mettre fin au pilote (pendant les 30 premiers jours ou après) moyennant un **préavis de 15 jours**, notifié par écrit (email suffit). Ce préavis laisse au Commerce le temps d'informer ses clients et de traiter les soldes de fidélité en cours.

## 5. Données traitées et rôles RGPD

- Pour les données du programme de fidélité (clients, cartes, transactions) : le **Commerce** est responsable du traitement, **Retiko** agit comme sous-traitant. Le détail figure dans l'annexe `ANNEXE-SOUS-TRAITANCE-RGPD.md`, partie intégrante du présent accord.
- Pour les données du compte SaaS du Commerce (accès, facturation, support) : **Retiko** est responsable du traitement.

## 6. Support

Retiko assure un support raisonnable pendant la durée du pilote, notamment lors du premier service. Objectif interne (non contractuel) : prise en compte d'un incident bloquant en moins de 30 minutes pendant les plages de service critiques déclarées par le Commerce.

## 7. Disponibilité

Aucune garantie de disponibilité (SLA) n'est due pendant le pilote. Les plages de service critiques du Commerce sont déclarées à Retiko et servent uniquement à mesurer la disponibilité pendant ces plages (voir `docs/PILOT.md`).

## 8. Relevé hebdomadaire

Le Commerce s'engage à transmettre, une fois par semaine, le nombre de tickets de caisse de la période, afin de permettre le calcul du taux d'adoption (`scans fidélité / tickets caisse`).

## 9. Propriété des données

Les données du programme de fidélité appartiennent au Commerce. En fin de pilote, le Commerce peut demander l'export intégral de ses données clients (`PROCEDURE-EXPORT-SUPPRESSION.md`) ou leur suppression.

## 10. Absence d'engagement après le pilote

Aucune des parties n'est engagée sur une suite commerciale après le pilote. Une éventuelle offre commerciale ultérieure fera l'objet d'un accord distinct.

## 11. Signatures

| Retiko | Le Commerce |
|---|---|
| [Nom, fonction, date] | [Nom, fonction, date] |

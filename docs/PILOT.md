# Checklist pilote terrain Retiko

## Avant le commerce

- utiliser `https://retiko.fr` sur tous les QR imprimés ;
- vérifier `/api/health` sur la production HTTPS ;
- créer le restaurant ;
- choisir tampons ou points ;
- créer un accès employé scanner ;
- imprimer l'affiche `/dashboard/poster` ;
- ouvrir la PWA `/s` sur l'appareil caisse ;
- tester Safari iOS, PWA iOS, Chrome Android et PWA Android ;
- définir les plages de service critiques ;
- garder une carte papier en parallèle le premier jour.

## Test technique

Effectuer 30 passages en conditions réelles et relever `/s/stats`.

- p95 < 2,5 s : GO ;
- 2,5 à 3,0 s : optimiser ;
- > 3,0 s : stopper le scope et traiter scan/réseau ;
- double crédit : blocker absolu.

## Test business

Le pilote dure 30 jours et reste gratuit. Mesurer prospects, démos, pilotes, temps d'installation et incidents caisse. Relever chaque semaine le nombre de tickets de caisse afin de calculer `scans fidélité / tickets caisse`.

Le commerce communique ses plages de service critiques. La disponibilité pilote se mesure séparément pendant ces plages : une panne à 03:00 n'a pas le même poids qu'une indisponibilité à 12:45.

## Jour 31

Le programme ne s'arrête pas automatiquement au terme des 30 jours. Il continue de fonctionner gratuitement jusqu'à décision explicite de l'une des deux parties. Toute interruption du programme pilote est annoncée avec un préavis de 15 jours afin de laisser au commerce le temps d'informer ses clients et de traiter les soldes fidélité en cours.

Cette continuité ne crée pas d'engagement commercial à durée indéterminée ni de garantie de disponibilité ; elle évite simplement de rendre inutilisables du jour au lendemain les cartes déjà distribuées.

## Incident pendant le service

1. Ne pas ralentir la file.
2. Noter le code court et l'opération attendue.
3. Continuer le service.
4. Régulariser ensuite depuis Clients → Ajuster, avec un motif obligatoire.

Toute régularisation produit une transaction `adjust` et un audit `CARD_ADJUSTED`.

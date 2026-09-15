# Checklist pilote terrain

## Avant le commerce

- fixer le domaine définitif avant d'imprimer le moindre QR ;
- vérifier `/api/health` sur la production HTTPS ;
- créer le restaurant ;
- choisir tampons ou points ;
- créer un accès employé scanner ;
- imprimer l'affiche `/dashboard/poster` ;
- ouvrir la PWA `/s` sur l'appareil caisse ;
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

## Incident pendant le service

1. Ne pas ralentir la file.
2. Noter le code court et l'opération attendue.
3. Continuer le service.
4. Régulariser ensuite depuis Clients → Ajuster, avec un motif obligatoire.

Toute régularisation produit une transaction `adjust` et un audit `CARD_ADJUSTED`.

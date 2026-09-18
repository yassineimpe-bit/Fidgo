# Installation

## Prérequis

- Node.js 20+ (22 recommandé)
- PostgreSQL 15+ accessible en TLS
- un domaine HTTPS pour tester la caméra sur mobile

## Local

```bash
cp .env.example .env.local
npm install
npm run env:check
npm run db:setup
npm run dev
```

Puis ouvrir `/signup`.

## Validation

```bash
npm run check
```

Ce script exécute typecheck, lint, tests et build Next.js. Le workflow GitHub CI exécute les mêmes contrôles.

La CI lance aussi les tests Playwright avec PostgreSQL et Chromium :

```bash
DATABASE_URL='postgres://...' npm run db:setup
DATABASE_URL='postgres://...' npm run test:e2e
```

Ils couvrent la boucle inscription → crédit → récompense, le polling de la carte et l'isolation entre deux commerces.

Pour rejouer localement tout le gate automatisé pilote avec une seule commande :

```bash
DATABASE_URL='postgres://fidgo:fidgo@127.0.0.1:5432/fidgo_test' npm run pilot:check
```

`pilot:check` exécute également le scénario de 30 opérations et `db:verify` avant/après les E2E. Il refuse volontairement les hôtes distants, les environnements production et les bases dont le nom ne contient pas `test`.

## Déploiement Vercel

1. Créer PostgreSQL en région UE.
2. Définir `DATABASE_URL`, `AUTH_SECRET` et `NEXT_PUBLIC_APP_URL`.
3. Exécuter `npm run db:setup` afin d'appliquer le schéma et toutes les migrations versionnées jusqu'à `013_stripe_billing_v2.sql`.
4. Déployer sur Vercel, région `fra1`.
5. Vérifier `/api/health`.
6. Tester `/s` sur Safari iPhone et Chrome Android en HTTPS.

## Validation PWA sur appareils physiques

### iPhone / Safari

1. Ouvrir `https://retiko.fr/s` et se connecter.
2. Safari → Partager → **Sur l'écran d'accueil**.
3. Lancer Retiko depuis l'icône et vérifier l'ouverture en mode standalone.
4. Autoriser la caméra, scanner une carte puis fermer/réouvrir l'app.
5. Couper le réseau et naviguer : Retiko doit afficher la page neutre `/offline`, sans mettre en cache une carte, un client, le scanner ou le dashboard.
6. Rétablir le réseau puis reprendre le scanner. Aucune opération ne doit avoir été mise en file d'attente hors ligne.

### Android / Chrome

1. Ouvrir `https://retiko.fr/s` et se connecter.
2. Chrome → **Installer l'application** / **Ajouter à l'écran d'accueil**.
3. Vérifier le mode standalone, la caméra et un scan réel.
4. Refaire le test de coupure réseau décrit ci-dessus.

Le service worker ne met en cache que le shell public (`/`, `/login`, `/signup`, `/offline`, manifeste et icône). Les routes `/api`, cartes, clients, dashboard et scanner ne sont jamais stockées comme réponses métier hors ligne.

## Gate pilote

30 actions réelles, p95 détection QR → validation < 2,5 s, aucun double crédit, retry réseau idempotent, test cross-tenant, employé désactivé et export/effacement RGPD.

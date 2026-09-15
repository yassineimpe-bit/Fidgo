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

## Déploiement Vercel

1. Créer PostgreSQL en région UE.
2. Définir `DATABASE_URL`, `AUTH_SECRET` et `NEXT_PUBLIC_APP_URL`.
3. Exécuter `npm run db:setup`, notamment pour les migrations `006_pilot_v0.sql` et `007_product_events.sql`.
4. Déployer sur Vercel, région `fra1`.
5. Vérifier `/api/health`.
6. Tester `/s` sur Safari iPhone et Chrome Android en HTTPS.

## Gate pilote

30 actions réelles, p95 détection QR → validation < 2,5 s, aucun double crédit, retry réseau idempotent, test cross-tenant, employé désactivé et export/effacement RGPD.

# Loyalty Rush MVP

SaaS de fidélité digitale pour snacks, restaurants, coffee shops, fast-foods, boulangeries et petits commerces alimentaires.

## MVP actuel

- création restaurant + owner ;
- session sécurisée httpOnly, revérifiée en base ;
- rôles OWNER/MANAGER/EMPLOYEE/VIEWER ;
- création/désactivation d'accès caisse ;
- programme **tampons ou points** ;
- points fixes par achat **ou** points calculés par euro ;
- inscription client avec données facultatives et consentement marketing séparé ;
- carte web mobile + QR sécurisé `LOY1:<token>` ;
- scanner caisse caméra toujours ouverte ;
- crédit transactionnel, idempotence, cooldown et limite quotidienne ;
- redeem de récompense ;
- ledger append-only + annulation par écriture inverse ;
- dashboard, clients et historique ;
- export/effacement RGPD ;
- personnalisation commerce ;
- affiche QR A4 ;
- PWA minimale et instrumentation p50/p95 QR → validation ;
- schéma prêt pour Apple Wallet, Google Wallet, campagnes, push et Stripe ;
- anti-bruteforce simple PostgreSQL et contrôle d'origine sur les mutations.

## Volontairement après validation terrain

- émission réelle Apple Wallet / Google Wallet ;
- Web Push et campagnes ;
- Stripe ;
- multi-sites ;
- analytics avancées.

## Critère produit

> Détecter la carte et effectuer l'action fidélité en moins de 3 secondes pendant un rush.

Gate terrain : **30 scans, p95 < 2,5 s, zéro double crédit**.

## Démarrage

```bash
cp .env.example .env.local
npm install
npm run env:check
npm run db:setup
npm run dev
```

Puis ouvrir `/signup`.

Documentation : `docs/INSTALLATION.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/RGPD.md`, `docs/WALLETS.md`, `docs/PILOT.md`.

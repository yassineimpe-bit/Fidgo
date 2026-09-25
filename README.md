# Retiko

SaaS de fidélité digitale pour snacks, restaurants, coffee shops, fast-foods, boulangeries et petits commerces alimentaires.

## MVP actuel

- création restaurant + owner ;
- session sécurisée httpOnly, revérifiée en base ;
- rôles OWNER/MANAGER/EMPLOYEE/VIEWER ;
- création/désactivation d'accès caisse ;
- programme **tampons ou points** ;
- points fixes par achat **ou** points calculés par euro ;
- inscription client avec email obligatoire, téléphone facultatif et consentement marketing séparé ;
- carte web mobile + QR sécurisé `LOY1:<token>` ;
- mise à jour automatique du solde quand la carte reste visible, avec token hors URL de polling ;
- scanner caisse caméra toujours ouverte + recherche code court ;
- crédit transactionnel, idempotence, cooldown et limite quotidienne ;
- override du cooldown et ajustement manuel réservés aux responsables, avec motif et audit ;
- consommation de récompense réservée à une session staff authentifiée ;
- ledger append-only + annulation par écriture inverse ;
- dashboard, clients et historique ;
- export/effacement RGPD ;
- personnalisation commerce ;
- affiche QR A4 ;
- PWA minimale et instrumentation p50/p95 QR → validation ;
- événements pilote persistés sans token brut ni coordonnées client ;
- récupération de carte par email avec jeton à usage unique et réponse anti-énumération ;
- Stripe Checkout/Portal et synchronisation webhook prêts derrière un feature flag désactivé ;
- anti-bruteforce PostgreSQL et contrôle d'origine sur les mutations.

## Volontairement après validation terrain

- émission réelle Apple Wallet / Google Wallet ;
- Web Push et campagnes ;
- activation opérationnelle Stripe après validation fiscale et contractuelle ;
- multi-sites ;
- analytics avancées.

## Critère produit

> Détecter la carte et effectuer l'action fidélité en moins de 3 secondes pendant un rush.

Gate terrain : **30 scans physiques (15 iPhone + 15 Android), p95 QR détecté → action validée sous le seuil officiel, zéro double crédit**. Seuil officiel encore à décider : p95 < 2,5 s (historique) ou p95 ≤ 2 s (protocole physique) — voir `docs/protocole-validation-physique-retiko.md`, dont la collecte s'analyse avec `npm run pilot:field-report` et `npm run pilot:ledger-audit`.

## Domaine pilote

Le domaine produit définitif est `retiko.fr`. Tant que le DNS OVH n'est pas attaché à Vercel, l'ancien domaine Vercel reste uniquement un endpoint technique de transition et ne doit pas apparaître sur des supports imprimés.

## Démarrage

```bash
cp .env.example .env.local
npm install
npm run env:check
npm run db:setup
npm run dev
```

Puis ouvrir `/signup`.

Le cahier des charges consolidé se trouve dans `SPEC-V0.md`. Documentation technique : `docs/INSTALLATION.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/RGPD.md`, `docs/LEGAL_STATUS.md` (légal et RGPD), `docs/DATA_LIFECYCLE.md`, `docs/OBSERVABILITY.md`, `docs/WALLETS.md`, `docs/BILLING.md`, `docs/PILOT.md`.

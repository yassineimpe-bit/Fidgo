# SPEC MVP — Fidgo

## Règle d'or

Le produit complet vise Wallet, campagnes et abonnement SaaS, mais le premier risque à éliminer reste opérationnel :

> Un commerce peut-il identifier une carte et effectuer l'action fidélité en moins de 3 secondes sans gêner son service ?

## MVP cœur

- création restaurant + owner ;
- connexion commerçant ;
- programme configurable `STAMPS` ou `POINTS` ;
- QR d'inscription client ;
- données de contact facultatives ;
- consentement marketing séparé ;
- carte web/PWA avec QR `LOY1:<token>` ;
- scanner caisse caméra toujours ouverte ;
- ajout tampons ou points ;
- redeem de récompense ;
- cooldown, limite quotidienne, idempotence et verrou transactionnel ;
- historique append-only et reversal ;
- dashboard simple ;
- affiche QR A4 ;
- p50/p95 sur le poste de caisse.

## Après validation terrain

- Apple Wallet / PassKit ;
- Google Wallet Loyalty ;
- Web Push et campagnes ;
- Stripe ;
- multi-sites ;
- automatisations et segmentation.

## Critère pilote

- 30 scans réels ;
- p95 < 2,5 s ;
- zéro double crédit ;
- iPhone + Android, navigateur + PWA ;
- fallback code court/email ;
- aucune fuite cross-tenant.

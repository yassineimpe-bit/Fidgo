# SPEC MVP — Loyalty Rush

## Règle d'or

Le produit complet vise Wallet, campagnes et abonnement SaaS, mais le premier risque à éliminer reste opérationnel :

> Un commerce peut-il identifier une carte et effectuer l'action fidélité en moins de 3 secondes sans gêner son service ?

Les choix d'architecture doivent préserver ce chemin critique.

## MVP cœur actuellement visé

- création restaurant + owner ;
- connexion commerçant ;
- programme configurable `STAMPS` ou `POINTS` ;
- QR d'inscription client ;
- données de contact facultatives ;
- consentement marketing séparé ;
- carte web/PWA avec QR `LOY1:<token>` ;
- scanner caisse caméra toujours ouverte ;
- fiche client minimale après scan ;
- ajout tampons ou points ;
- redeem de récompense ;
- cooldown, limite quotidienne, idempotence et verrou transactionnel ;
- historique append-only et reversal ;
- dashboard simple ;
- affiche QR A4 ;
- mesures p50/p95/max sur le poste de caisse.

## Architecture prête mais activation après validation terrain

- Apple Wallet / PassKit ;
- Google Wallet Loyalty ;
- Web Push et campagnes ;
- employés/invitations avancées ;
- Stripe ;
- multi-sites ;
- automatisations et segmentation.

## Critère pilote

- 30 scans réels ;
- p95 < 2,5 s sur le flux opérationnel mesuré ;
- zéro double crédit ;
- test iPhone + Android, navigateur + PWA ;
- fallback code court/email utilisable ;
- aucune fuite cross-tenant.

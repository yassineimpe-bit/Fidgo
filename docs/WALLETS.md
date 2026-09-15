# Apple Wallet et Google Wallet

Les APIs Wallet évoluent : revalider la documentation officielle avant activation production.

## Apple Wallet

Pré-requis : compte Apple Developer, Pass Type ID, certificat de signature et assets conformes. Le QR du pass reste `LOY1:<card.token>`. Les tables `wallet_passes` et `apple_wallet_registrations` préparent le web service de mise à jour.

Documentation officielle :
- https://developer.apple.com/documentation/walletpasses/distributing-and-updating-a-pass
- https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes

## Google Wallet

Une Loyalty Class par établissement/programme et un Loyalty Object par carte/client. L'ajout utilise le flux officiel “Add to Google Wallet” avec JWT signé. `wallet_passes.external_id` conserve l'identifiant Google.

Documentation officielle :
- https://developers.google.com/wallet/retail/loyalty-cards/use-cases/create
- https://developers.google.com/wallet/generic/overview/add-to-google-wallet-flow

## Ordre

1. valider 30 scans web/PWA et p95 < 2,5 s ;
2. intégrer Google Wallet ;
3. intégrer Apple PassKit ;
4. déclencher les mises à jour après transaction commit ;
5. instrumenter les erreurs Wallet ;
6. seulement ensuite activer les campagnes Wallet.

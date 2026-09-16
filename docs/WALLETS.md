# Apple Wallet et Google Wallet

Retiko émet maintenant de vrais passes Wallet lorsque les credentials correspondants sont activés. Le QR contenu dans les deux portefeuilles reste `LOY1:<card.token>` : le scanner caisse ne change pas.

## Google Wallet

Pré-requis externes :
1. créer/ouvrir un compte Google Wallet issuer dans la Google Pay & Wallet Console ;
2. créer un service account Google Cloud ;
3. autoriser ce service account dans le compte issuer ;
4. récupérer l'Issuer ID ;
5. encoder le JSON du service account en base64.

Variables :
- `GOOGLE_WALLET_ENABLED=true`
- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`

Au premier clic sur `/api/wallet/google/[token]`, Retiko :
- crée la Loyalty Class du restaurant si nécessaire ;
- crée/actualise le Loyalty Object de la carte ;
- génère un JWT signé `savetowallet` ;
- redirige vers `https://pay.google.com/gp/v/save/<jwt>`.

Après un crédit, redeem ou reversal, `after()` patche l'objet Google hors du chemin critique caisse.

Documentation officielle :
- https://developers.google.com/wallet/retail/loyalty-cards/use-cases/create
- https://developers.google.com/wallet/retail/loyalty-cards/web
- https://developers.google.com/wallet/retail/loyalty-cards/use-cases/updates

## Apple Wallet

Pré-requis externes :
1. compte Apple Developer ;
2. créer un Pass Type Identifier, par exemple `pass.fr.retiko.loyalty` ;
3. créer le certificat associé au Pass Type ID ;
4. exporter le certificat de signature et sa clé privée en PEM ;
5. récupérer le certificat Apple WWDR en PEM ;
6. encoder les trois PEM en base64.

Variables :
- `APPLE_WALLET_ENABLED=true`
- `APPLE_PASS_TYPE_IDENTIFIER`
- `APPLE_TEAM_IDENTIFIER`
- `APPLE_WWDR_CERT_BASE64`
- `APPLE_SIGNER_CERT_BASE64`
- `APPLE_SIGNER_KEY_BASE64`
- `APPLE_SIGNER_KEY_PASSPHRASE` si la clé est chiffrée.

`GET /api/wallet/apple/[token]` génère et signe un `.pkpass` de type `storeCard` avec :
- restaurant / programme ;
- solde tampons ou points ;
- état de la récompense ;
- code court ;
- QR `LOY1:<token>` ;
- `webServiceURL` Retiko et token d'authentification dérivé par HMAC.

Le service Apple est exposé sous `/api/wallet/apple/web/v1/...` et implémente :
- enregistrement appareil + push token ;
- désenregistrement ;
- liste des passes mises à jour ;
- téléchargement de la nouvelle version du pass ;
- endpoint de logs.

Après modification du solde, Retiko utilise `after()` pour envoyer le push de mise à jour aux appareils Apple enregistrés. Le device récupère ensuite le nouveau `.pkpass` portant le même Pass Type ID et le même serial number.

Documentation officielle :
- https://developer.apple.com/documentation/walletpasses/creating-a-store-card-pass
- https://developer.apple.com/documentation/walletpasses/distributing-and-updating-a-pass
- https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes

## Validation avant activation commerciale

- tester un ajout réel Apple Wallet sur iPhone ;
- tester un ajout réel Google Wallet sur Android ;
- créditer une carte installée et vérifier que le solde se met à jour ;
- redeem et reversal doivent également être reflétés ;
- le QR Wallet doit scanner avec le même p95 que la carte web ;
- ne jamais committer certificats, clés privées ou JSON de service account dans GitHub.

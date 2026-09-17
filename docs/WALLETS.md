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

Le code est terminé et validé par un test qui génère un vrai `.pkpass` signé
avec une chaîne de certificats jetable (`tests/apple-wallet-pass.test.ts`) :
seule l'obtention des vrais certificats Apple, ci-dessous, reste à faire côté
humain avant un test physique sur iPhone.

### 1. Créer le Pass Type Identifier

Dans [developer.apple.com/account/resources/identifiers](https://developer.apple.com/account/resources/identifiers/list) :
1. `+` → **Pass Type IDs** → description libre, identifiant par exemple
   `pass.fr.retiko.loyalty`. C'est la valeur de `APPLE_PASS_TYPE_IDENTIFIER`.
2. Noter le **Team ID** affiché en haut à droite du compte développeur : c'est
   `APPLE_TEAM_IDENTIFIER`.

### 2. Générer la demande de certificat (CSR) et la clé privée

En local, avec `openssl` (jamais sur un poste partagé, la clé ne doit jamais
sortir de cette machine ni être commit) :

```sh
openssl req -new -newkey rsa:2048 -nodes \
  -keyout retiko-pass-signer.key \
  -out retiko-pass-signer.csr \
  -subj "/CN=Retiko Pass Signer"
```

### 3. Générer le certificat depuis Apple

Sur la page du Pass Type ID créé à l'étape 1 : **Create Certificate** → upload
`retiko-pass-signer.csr` → télécharger le `.cer` produit (`pass.cer`).

Convertir ce `.cer` (format DER) en PEM :

```sh
openssl x509 -inform DER -in pass.cer -out retiko-pass-signer.pem
```

### 4. Récupérer le certificat Apple WWDR

Télécharger le certificat WWDR (G4 au moment de l'écriture) depuis
[Apple PKI](https://www.apple.com/certificateauthority/) → **Worldwide
Developer Relations - G4**, puis le convertir en PEM :

```sh
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out apple-wwdr.pem
```

### 5. Encoder les trois PEM en base64 pour les variables d'environnement

```sh
base64 -i apple-wwdr.pem            | tr -d '\n' > APPLE_WWDR_CERT_BASE64.txt
base64 -i retiko-pass-signer.pem    | tr -d '\n' > APPLE_SIGNER_CERT_BASE64.txt
base64 -i retiko-pass-signer.key    | tr -d '\n' > APPLE_SIGNER_KEY_BASE64.txt
```

(sur Linux, `base64 -w0` remplace `base64 ... | tr -d '\n'`). Coller le
contenu de chaque fichier `.txt` dans la variable Vercel correspondante, puis
supprimer ces fichiers locaux — ce sont des secrets au même titre qu'un mot de
passe.

Variables à définir dans Vercel (jamais dans le dépôt) :
- `APPLE_WALLET_ENABLED=true`
- `APPLE_PASS_TYPE_IDENTIFIER` (étape 1)
- `APPLE_TEAM_IDENTIFIER` (étape 1)
- `APPLE_WWDR_CERT_BASE64` (étape 5)
- `APPLE_SIGNER_CERT_BASE64` (étape 5)
- `APPLE_SIGNER_KEY_BASE64` (étape 5)
- `APPLE_SIGNER_KEY_PASSPHRASE` uniquement si la clé a été générée avec une
  passphrase (pas le cas de la commande `-nodes` ci-dessus).

`/dashboard/wallet` (déjà en place) confirme si les cinq variables Apple sont
présentes et *cryptographiquement valides* (le certificat parse comme un vrai
X.509, la clé comme une vraie clé privée) avant d'afficher "Prêt" — sans
jamais réafficher leur contenu.

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

### Limite connue (cosmétique, pas fonctionnelle)

`public/wallet-logo.png` est un carré 256×256 réutilisé à la fois comme icône
(29×29pt, carré : correct) et comme logo (jusqu'à 160×50pt, rectangulaire).
Le pass reste valide et s'installe normalement, mais le logo apparaîtra
recadré en carré au lieu d'un logotype large. Un vrai logo rectangulaire
(fond transparent, ~160×50pt @1x) améliorera le rendu sans toucher au code —
seul le fichier `public/wallet-logo.png` serait à remplacer.

## Validation avant activation commerciale

- tester un ajout réel Apple Wallet sur iPhone ;
- tester un ajout réel Google Wallet sur Android ;
- créditer une carte installée et vérifier que le solde se met à jour ;
- redeem et reversal doivent également être reflétés ;
- le QR Wallet doit scanner avec le même p95 que la carte web ;
- ne jamais committer certificats, clés privées ou JSON de service account dans GitHub.

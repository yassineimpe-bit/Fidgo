# Déploiement Fidgo

## 1. PostgreSQL

Créer une base PostgreSQL managée dans l'Union européenne (Neon ou équivalent), puis récupérer `DATABASE_URL` avec SSL.

Initialiser la base :

```bash
DATABASE_URL='postgres://...' npm run db:setup
```

Créer le commerce et la carte de démonstration :

```bash
DATABASE_URL='postgres://...' \
NEXT_PUBLIC_APP_URL='https://votre-domaine' \
DEMO_OWNER_EMAIL='demo@example.com' \
DEMO_OWNER_PASSWORD='mot-de-passe-solide' \
npm run db:seed:demo
```

Ou faire les deux :

```bash
npm run bootstrap:demo
```

Le script affiche ensuite l'URL publique d'inscription et l'URL de la carte de démonstration.

## 2. Vercel

Importer `yassineimpe-bit/Fidgo` dans Vercel.

Région imposée par `vercel.json` : `fra1`.

Variables minimales :

- `DATABASE_URL`
- `AUTH_SECRET` (au moins 32 caractères aléatoires)
- `NEXT_PUBLIC_APP_URL` (URL HTTPS de production)
- `APPLE_WALLET_ENABLED=false` tant que les certificats Apple ne sont pas installés
- `GOOGLE_WALLET_ENABLED=false` tant que l'Issuer Google n'est pas configuré

Après le premier déploiement :

1. vérifier `GET /api/health` ;
2. exécuter `npm run bootstrap:demo` contre la base de production ;
3. ouvrir `/j/fidgo-demo` ;
4. ouvrir la carte créée ;
5. vérifier le scanner `/s` avec un compte Owner de démo.

## 3. Google Wallet

Configurer dans Vercel :

- `GOOGLE_WALLET_ENABLED=true`
- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`

Le compte de service doit être autorisé dans le compte Google Wallet issuer.

Une fois activé, la page carte affiche `Ajouter à Google Wallet`. Le clic crée/met à jour la Loyalty Class et le Loyalty Object puis redirige vers la feuille officielle Google Wallet.

## 4. Apple Wallet

Configurer dans Vercel :

- `APPLE_WALLET_ENABLED=true`
- `APPLE_PASS_TYPE_IDENTIFIER`
- `APPLE_TEAM_IDENTIFIER`
- `APPLE_WWDR_CERT_BASE64`
- `APPLE_SIGNER_CERT_BASE64`
- `APPLE_SIGNER_KEY_BASE64`
- `APPLE_SIGNER_KEY_PASSPHRASE` si nécessaire

Le certificat doit correspondre au Pass Type Identifier du compte Apple Developer.

Une fois activé, la page carte télécharge un `.pkpass` signé. Safari/iOS présente ensuite la feuille système `Ajouter à Apple Wallet`.

## 5. Gate avant pilote

Ne pas considérer Fidgo `PILOT READY` avant :

- `/api/health` vert sur HTTPS ;
- inscription réelle client ;
- carte web réelle ;
- ajout Google Wallet réel sur Android ;
- ajout Apple Wallet réel sur iPhone ;
- mise à jour du solde reflétée dans les deux Wallets ;
- 30 scans terrain ;
- p95 QR détecté → action validée < 2,5 s ;
- aucun double crédit ;
- test de coupure réseau / retry ;
- validation isolation multi-tenant.

Les certificats, clés privées et JSON de service account ne doivent jamais être commités dans GitHub.

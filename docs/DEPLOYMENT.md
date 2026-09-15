# Déploiement Fidgo

## 1. PostgreSQL

La base de production actuelle est hébergée sur Neon dans l'Union européenne. `DATABASE_URL` doit rester un secret de déploiement et ne jamais être commitée.

Initialiser une nouvelle base si nécessaire :

```bash
DATABASE_URL='postgres://...' npm run db:setup
```

Créer ou remettre à niveau le commerce et la carte de démonstration :

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

Le seed est idempotent et vérifie l'intégrité du ledger de la carte de démonstration.

## 2. Vercel

Importer **exactement** `yassineimpe-bit/Fidgo` dans le projet Vercel et utiliser `main` comme Production Branch.

Connecter le dépôt GitHub `yassineimpe-bit/Fidgo` au projet Vercel de production. Chaque nouveau push sur `main` doit créer automatiquement un déploiement de production.

Ne jamais imprimer ni communiquer un QR fondé sur `fidgo-env-probe.vercel.app`. Configurer d'abord le domaine définitif et l'utiliser dans `NEXT_PUBLIC_APP_URL`.

Région imposée par `vercel.json` : `fra1`.

Le code doit pouvoir construire sans secrets de production. Tant que les secrets ne sont pas installés, `/api/health` répond proprement en erreur de readiness au lieu de casser le build.

Variables runtime minimales :

- `DATABASE_URL`
- `AUTH_SECRET` (au moins 32 caractères aléatoires, stocké comme variable sensible)
- `NEXT_PUBLIC_APP_URL` doit contenir le domaine HTTPS définitif avant tout pilote
- `APPLE_WALLET_ENABLED=false` tant que les certificats Apple ne sont pas installés
- `GOOGLE_WALLET_ENABLED=false` tant que l'Issuer Google n'est pas configuré

Après modification d'une variable, créer un nouveau déploiement : un ancien déploiement ne récupère pas rétroactivement les nouvelles variables.

Le healthcheck de production doit notamment renvoyer :

- `ok: true`
- `database: "up"`
- `auth: "up"`
- `wallet.https: true`

Après le premier déploiement sain :

1. vérifier `GET /api/health` ;
2. ouvrir `/j/fidgo-demo` ;
3. vérifier la carte de démonstration ;
4. créer un compte Owner réel via `/signup` ou le seed de démo ;
5. vérifier le scanner `/s` ;
6. tester crédit, remboursement/récompense, rejeu idempotent et annulation.

## 3. Google Wallet

Configurer dans Vercel :

- `GOOGLE_WALLET_ENABLED=true`
- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`

Le compte de service doit être autorisé dans le compte Google Wallet issuer. Les boutons Wallet restent désactivés tant que HTTPS et les identifiants requis ne sont pas réellement complets.

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

`AUTH_SECRET` doit également être présent. Le certificat doit correspondre au Pass Type Identifier du compte Apple Developer.

Une fois activé, la page carte télécharge un `.pkpass` signé. Safari/iOS présente ensuite la feuille système `Ajouter à Apple Wallet`.

## 5. Gate avant pilote

Ne pas considérer Fidgo `PILOT READY` avant :

- `/api/health` vert sur HTTPS ;
- inscription réelle client ;
- carte web réelle ;
- auto-rafraîchissement de la carte web vérifié ;
- récupération sécurisée par email vérifiée ;
- 30 scans terrain ;
- p95 QR détecté → action validée < 2,5 s ;
- aucun double crédit ;
- test de coupure réseau / retry ;
- validation isolation multi-tenant.

Apple Wallet et Google Wallet peuvent rester désactivés pour le premier pilote.

Les certificats, clés privées, mots de passe, connection strings et JSON de service account ne doivent jamais être commités dans GitHub.

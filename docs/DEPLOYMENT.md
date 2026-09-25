# Déploiement Retiko

## 1. PostgreSQL

La base de production actuelle est hébergée sur Neon dans l'Union européenne. `DATABASE_URL` doit rester un secret de déploiement et ne jamais être commitée.

Initialiser une nouvelle base si nécessaire :

```bash
DATABASE_URL='postgres://...' npm run db:setup
```

Créer ou remettre à niveau le commerce et la carte de démonstration :

```bash
DATABASE_URL='postgres://...' \
NEXT_PUBLIC_APP_URL='https://retiko.fr' \
DEMO_OWNER_EMAIL='demo@example.com' \
DEMO_OWNER_PASSWORD='mot-de-passe-solide' \
npm run db:seed:demo
```

Ou faire les deux :

```bash
npm run bootstrap:demo
```

Le seed est idempotent et vérifie l'intégrité du ledger de la carte de démonstration.

La migration `012_data_lifecycle.sql` protège le ledger contre les hard-deletes
et répare les anciennes suppressions logiques. Elle fait partie du schéma exigé
par `/api/health`. Pour toute nouvelle base : la tester d'abord sur une branche
Neon temporaire, créer un point de restauration avant production, l'appliquer
puis exécuter `npm run db:verify`.

La migration `013_stripe_billing_v2.sql` doit être appliquée et vérifiée avant
d'activer la facturation. Le code reste compatible avec le schéma précédent
tant que `STRIPE_ENABLED=false`, afin qu'un déploiement applicatif ne casse ni
le healthcheck ni le signup pendant la préparation de la migration. Celle-ci
ne doit jamais être exécutée par un build Vercel et n'active pas Stripe :
`STRIPE_ENABLED=false` reste la valeur sûre jusqu'à la validation opérationnelle
décrite dans `docs/BILLING.md`.

La maintenance de rétention reste manuelle pendant le pilote :

```bash
# Observation uniquement
npm run data:purge

# Après validation des volumes et durées, une seule tranche de 5 000 lignes/table
npm run data:purge -- --execute
```

Ne jamais automatiser cette commande avant validation de la politique décrite
dans `docs/DATA_LIFECYCLE.md`.

## 2. Domaine `retiko.fr` + Vercel

Le domaine définitif est `retiko.fr`, enregistré chez OVHcloud. Il doit être attaché au projet Vercel avant toute impression de QR, activation publique des liens de récupération et émission Wallet réelle.

Importer **exactement** `yassineimpe-bit/Fidgo` dans le projet Vercel et utiliser `main` comme Production Branch.

Ne jamais imprimer ni communiquer un QR fondé sur `fidgo-env-probe.vercel.app`. Ce domaine reste uniquement un endpoint technique de transition.

Étapes de cutover :

1. ajouter `retiko.fr` au projet Vercel ;
2. ajouter aussi `www.retiko.fr` si souhaité et le rediriger vers le domaine canonique ;
3. recopier dans la zone DNS OVH les enregistrements demandés par Vercel ;
4. attendre la validation HTTPS Vercel ;
5. définir `NEXT_PUBLIC_APP_URL=https://retiko.fr` en Production ;
6. redéployer ;
7. vérifier `https://retiko.fr/api/health` ;
8. seulement ensuite imprimer les QR et basculer le smoke test vers le domaine définitif.

Région imposée par `vercel.json` : `fra1`.

Variables runtime minimales :

- `DATABASE_URL`
- `AUTH_SECRET` (au moins 32 caractères aléatoires, stocké comme variable sensible)
- `NEXT_PUBLIC_APP_URL=https://retiko.fr`
- `APPLE_WALLET_ENABLED=false` tant que les certificats Apple ne sont pas installés
- `GOOGLE_WALLET_ENABLED=false` tant que l'Issuer Google n'est pas configuré

Après modification d'une variable, créer un nouveau déploiement : un ancien déploiement ne récupère pas rétroactivement les nouvelles variables.

Le healthcheck de production doit notamment renvoyer :

- `ok: true`
- `service: "retiko"`
- `database: "up"`
- `auth: "up"`
- `wallet.https: true`

Après le premier déploiement sain :

1. vérifier `GET /api/health` ;
2. ouvrir `/j/retiko-demo` si le seed de démonstration est utilisé ;
3. vérifier la carte de démonstration ;
4. créer un compte Owner réel via `/signup` ;
5. vérifier le scanner `/s` ;
6. tester crédit, récompense, rejeu idempotent et annulation.

## 3. Email transactionnel / Resend

L'email transactionnel est **requis en production** : l'inscription publique
d'un commerçant exige la vérification de son adresse. Sans les trois variables
ci-dessous, `/api/auth/signup` répond `503 EMAIL_VERIFICATION_UNAVAILABLE` et
`/api/health` reste en `503`. La récupération de carte client reste, elle,
activée séparément par `CARD_RECOVERY_ENABLED`.

Configuration cible :

- domaine expéditeur vérifié dans Resend : `retiko.fr` (région `eu-west-1`, envoi seul) ;
- adresse expéditrice : `Retiko <cartes@retiko.fr>` ;
- adresse de réponse surveillée : `contact@retiko.fr` ;
- `RESEND_API_KEY` en secret Vercel Production ;
- `EMAIL_FROM=Retiko <cartes@retiko.fr>` ;
- `EMAIL_REPLY_TO=contact@retiko.fr` ;
- `CARD_RECOVERY_ENABLED=true` uniquement après vérification DNS et test d'envoi réel.

Procédure :

1. ajouter `retiko.fr` dans Resend ;
2. recopier dans OVH les enregistrements SPF et DKIM exactement fournis par Resend, sans remplacer le SPF existant de l'apex `retiko.fr` ;
3. publier une politique DMARC pour `retiko.fr` (commencer par `p=none` avec rapports, puis durcir après observation) ;
4. attendre le statut **Verified** dans Resend et vérifier SPF, DKIM et DMARC avec un outil DNS externe ;
5. créer une clé API Resend dédiée à la production et limitée à l'envoi ;
6. ajouter les trois variables email dans Vercel Production, sans jamais commiter la clé ;
7. exécuter `npm run env:check` avec le contrat Production ;
8. envoyer un lien de récupération réel vers au moins Gmail et iCloud ;
9. vérifier l'expéditeur, le bouton mobile, la réponse vers `contact@retiko.fr`, l'expiration à 15 minutes et l'usage unique ;
10. activer `CARD_RECOVERY_ENABLED=true` et créer un nouveau déploiement.

Le code envoie une clé d'idempotence stable à Resend, applique un timeout et
des retries bornés uniquement aux erreurs réseau, `429` et `5xx`. Un nouveau
lien reste inactif tant que Resend n'a pas confirmé l'envoi : une panne email
n'invalide donc pas le dernier lien déjà livré.

La réponse publique à une demande de récupération reste identique qu'une carte existe ou non.

## 4. Google Wallet

Configurer dans Vercel :

- `GOOGLE_WALLET_ENABLED=true`
- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`

Le compte de service doit être autorisé dans le compte Google Wallet issuer. Les boutons Wallet restent désactivés tant que HTTPS et les identifiants requis ne sont pas réellement complets.

Une fois activé, la page carte affiche `Ajouter à Google Wallet`.

## 5. Apple Wallet

Configurer dans Vercel :

- `APPLE_WALLET_ENABLED=true`
- `APPLE_PASS_TYPE_IDENTIFIER`
- `APPLE_TEAM_IDENTIFIER`
- `APPLE_WWDR_CERT_BASE64`
- `APPLE_SIGNER_CERT_BASE64`
- `APPLE_SIGNER_KEY_BASE64`
- `APPLE_SIGNER_KEY_PASSPHRASE` si nécessaire

Le certificat doit correspondre au Pass Type Identifier du compte Apple Developer. Le web service Wallet doit utiliser `https://retiko.fr` une fois le domaine stabilisé.

## 6. Gate avant pilote

Ne pas considérer Retiko `PILOT READY` avant :

- `/api/health` vert sur `https://retiko.fr` ;
- isolation multi-tenant validée ;
- inscription réelle client avec email ;
- carte web réelle ;
- auto-rafraîchissement sans token dans l'URL ;
- récupération sécurisée par email vérifiée ;
- redemption impossible sans session staff ;
- PWA iOS et Android testées sur appareils physiques ;
- 30 scans terrain ;
- p95 QR détecté → action validée < 2,5 s ;
- aucun double crédit ;
- test de coupure réseau / retry.

Apple Wallet et Google Wallet peuvent rester désactivés pour le premier pilote.

Les certificats, clés privées, mots de passe, connection strings et JSON de service account ne doivent jamais être commités dans GitHub.

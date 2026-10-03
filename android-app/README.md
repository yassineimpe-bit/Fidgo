# Retiko Android

Cette app est un conteneur Android minimal autour de la PWA Retiko via une
**Trusted Web Activity (TWA)**. Le métier reste dans le projet Next.js : pas de
deuxième frontend, pas de deuxième logique d'authentification et pas de WebView
maison.

## Identité

- Package Android : `fr.retiko.app`
- Domaine vérifié : `https://retiko.fr`
- Écran de départ : `https://retiko.fr/s`
- `compileSdk` : 36
- `targetSdk` : 36
- `minSdk` : 23

Le package Android devient pratiquement immuable après publication sur Google
Play. Ne pas le renommer après la première release.

## Build local

Prérequis : JDK 17+, Android SDK Platform 36 / Build Tools 36 et Gradle 9.6.

Depuis ce dossier :

```bash
gradle :app:assembleDebug
gradle :app:bundleRelease
```

Le premier produit un APK de test. Le second produit un Android App Bundle
(`.aab`). Sans configuration de clé d'upload, le bundle release est non signé :
il sert à vérifier que le projet compile, pas encore à publier sur Google Play.

## Liaison retiko.fr <-> Android

La TWA n'est plein écran que si Android/Chrome peut vérifier que le site et
l'application appartiennent au même éditeur.

Retiko expose :

```text
https://retiko.fr/.well-known/assetlinks.json
```

Cette URL est réécrite vers `/api/android/assetlinks`. Le contenu est généré à
partir de :

```text
ANDROID_APP_SHA256_CERT_FINGERPRINTS
```

Après création de l'application dans Play Console, récupérer l'empreinte SHA-256
du **certificat de signature de l'application** dans la section Intégrité de
l'application, l'ajouter à l'environnement Production Vercel puis redéployer.

On peut mettre plusieurs empreintes séparées par une virgule ou un retour ligne
pour accepter temporairement une clé locale et la clé Play.

## Publication Google Play

1. Créer l'application Retiko dans Play Console avec le package `fr.retiko.app`.
2. Activer Play App Signing.
3. Créer/conserver une clé d'upload privée hors Git.
4. Signer le bundle release avec la clé d'upload.
5. Configurer l'empreinte SHA-256 Play dans Vercel.
6. Vérifier que `/.well-known/assetlinks.json` contient bien le package et
   l'empreinte attendus.
7. Tester sur un Android physique : login, scanner, caméra refusée/réautorisée,
   reprise après arrière-plan, Google Wallet et réseau dégradé.
8. Importer le `.aab` signé dans une piste de test interne avant toute
   publication publique.

Aucune clé privée, mot de passe de keystore ou fichier `.jks` ne doit être
commité.

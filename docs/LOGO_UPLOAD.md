# Logo du commerce

Retour terrain du 25/09/2026 : la seule URL de logo ne suffisait pas. Le
commerçant peut désormais **importer** son logo depuis les réglages ou
l'onboarding ; l'URL HTTPS externe reste possible.

## Parcours

1. « Importer un logo » : JPEG, PNG ou WebP, 2 Mo maximum (contrôlé dans le
   navigateur puis, surtout, sur le serveur).
2. Cadrage carré : glisser pour déplacer, curseur « Zoom », flèches du
   clavier pour ajuster. Le navigateur n'envoie que le fichier d'origine et les
   coordonnées du carré (`cropX`, `cropY`, `cropSize`).
3. « Enregistrer le logo » : le logo est actif immédiatement (carte client,
   inscription `/j/[slug]`, affiche, aperçu). « Retirer le logo » le supprime.

## Traitement serveur (`POST /api/restaurant/logo`)

| Contrôle | Règle |
|---|---|
| Droits | OWNER et MANAGER, contrôle d'origine, 20 imports par heure et par compte |
| Taille | `Content-Length` puis taille réelle : 2 Mo maximum (413) |
| Format | Octets de signature JPEG / PNG / WebP ; extension et `Content-Type` ignorés ; SVG, GIF, HEIC refusés (415) |
| Dimensions | 128 px minimum, 6 000 px maximum par côté, `limitInputPixels` contre les bombes de décompression |
| Cadrage | Entiers, carré d'au moins 128 px entièrement dans l'image orientée, sinon 400 ; carré central par défaut |
| Conversion | Orientation EXIF appliquée, recadrage, redimensionnement 512 × 512, **WebP** ; aucune métadonnée conservée (EXIF, GPS, profil) |
| Audit | `RESTAURANT_LOGO_UPLOADED` (taille, dimensions, cadrage oui/non), `RESTAURANT_LOGO_REMOVED` ; jamais le contenu |

## Stockage

- Table `establishment_logos` (migration `024`), dans la base PostgreSQL déjà
  utilisée et sauvegardée : **aucun nouveau prestataire**. Un logo WebP 512 px
  pèse quelques dizaines de Ko (512 Ko maximum imposés par la base).
- `establishments.logo_url` vaut `/api/logos/<uuid>` ; la contrainte
  `establishments_logo_url_https_check` accepte ce chemin en plus de `https://`.
- Remplacement, retrait, ou passage à une URL externe : l'ancien fichier est
  supprimé **dans la même transaction** que la mise à jour de `logo_url`.
- `db:verify` échoue si un commerce référence un logo absent ou d'un autre
  commerce, ou si un fichier n'est plus référencé.
- Un autre commerce ne peut pas réutiliser le chemin d'un logo qui ne lui
  appartient pas (`PATCH /api/restaurant` → 400).

Passer plus tard à un stockage objet ne touche que la route d'import et
`GET /api/logos/[id]` : les pages ne connaissent que l'URL.

## Diffusion (`GET /api/logos/[id]`)

Public, uniquement pour un commerce actif (404 sinon). Réponse immuable :
l'identifiant change à chaque import, donc
`cache-control: public, max-age=31536000, immutable`, avec `etag`,
`x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox`
et `cross-origin-resource-policy: same-site`.

## Déploiement

La migration `024_establishment_logos.sql` est additive et idempotente. Elle
doit être appliquée en production **avant** d'utiliser l'import : sans elle,
l'import répond `503 LOGO_STORAGE_UNAVAILABLE` et le reste de l'application
fonctionne normalement (URL externes comprises).

## Hors périmètre

- **Wallets** : Apple et Google Wallet gardent le logo Retiko statique
  (`public/wallet-logo.png`). Utiliser le logo du commerce impose les formats
  de chaque plateforme et une URL absolue HTTPS : décision produit à prendre.
- **Fond de carte** : couleur principale unie ou dégradé principale →
  secondaire (migration `030_card_design.sql`, `lib/card-design.ts`). La
  couleur secondaire, facultative, colore aussi la barre de progression quand
  elle reste lisible sur le fond ; le texte est choisi noir ou blanc selon la
  teinte moyenne du dégradé. Carte client, aperçu des réglages et onboarding
  partagent ce rendu. L'affiche imprimable et les Wallets gardent la seule
  couleur principale (les Wallets n'acceptent qu'une couleur de fond). Le logo
  s'affiche toujours sur une pastille blanche. Pas encore de fond image.
- **URL externes existantes** : conservées telles quelles, sans import
  automatique.

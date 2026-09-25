# Logo du commerce : état actuel et prérequis de l'upload

Note technique courte (retour terrain du 25/09/2026). L'upload **n'est pas
implémenté** : il dépend d'un choix de stockage qui n'est pas encore fait.
Aucun fournisseur n'est retenu ici.

## Aujourd'hui

- `establishments.logo_url` stocke une **URL HTTPS externe** (500 caractères
  maximum), validée par `safeHttpsUrl` dans `PATCH /api/restaurant`.
- L'image est affichée par une balise `<img>` à six endroits : carte client
  `/c/[token]`, inscription `/j/[slug]`, affiche, dashboard, réglages et
  onboarding. La CSP autorise `img-src 'self' data: https:`.
- Les Wallets **n'utilisent pas** ce logo : Apple et Google reçoivent le logo
  Retiko statique `public/wallet-logo.png`.
- Limites constatées : un lien externe peut casser ou changer de contenu.
  Chaque affichage envoie aussi une requête au serveur tiers depuis le
  navigateur du client, ce qui lui transmet son IP et peut servir de pixel de
  suivi. Enfin, aucun contrôle de taille, de format ni de dimensions n'est fait.

## À prévoir pour l'upload

| Sujet | Exigence |
|---|---|
| Formats | JPEG, PNG, WebP uniquement |
| Contrôle MIME | Lire les octets de signature (magic bytes) côté serveur : ne jamais se fier à l'extension ni au `Content-Type` envoyé |
| SVG | Refusé en entrée : il peut contenir du script et des liens externes. Si un jour autorisé, le rasteriser côté serveur, sans jamais servir le SVG d'origine |
| Taille | Limite en octets avant tout décodage (ordre de grandeur : 2 Mo), requête rejetée au-delà |
| Dimensions | Minimum (ex. 128 px) et maximum (protection contre les « bombes » de décompression) vérifiés après lecture de l'en-tête |
| Redimensionnement | Variantes générées côté serveur (carte, affiche, Wallet), métadonnées EXIF supprimées, orientation appliquée |
| Stockage objet | Fournisseur **à choisir** (critères : région UE, coût, suppression, intégration Vercel) ; clé non devinable, aucun nom de fichier d'origine |
| Accès | Logo public par nature (carte, affiche) : URL publique immuable avec cache long, ou URL signée si le fournisseur l'impose. Aucune liste publique des fichiers |
| Remplacement | L'ancien fichier est supprimé après le remplacement effectif, dans le même flux que la mise à jour de `logo_url`, avec reprise en cas d'échec |
| Suppression | Fermeture ou effacement du commerce : suppression du fichier (à ajouter à `docs/DATA_LIFECYCLE.md` et au registre) |
| Droits | OWNER et MANAGER, contrôle d'origine, rate limit, audit sans le contenu du fichier |
| Fond de carte | Couleur principale conservée derrière le logo (transparence PNG/WebP), contraste vérifié comme aujourd'hui |
| Cadrage / zoom | Aperçu avec recadrage carré et zoom avant envoi. Coordonnées de recadrage appliquées côté serveur, jamais une image recadrée par le navigateur sans contrôle |
| Wallets | Décider si le logo du commerce remplace le logo Retiko dans Apple / Google Wallet (formats et tailles imposés par chaque plateforme) |
| Migration | Garder le support des URL externes existantes le temps de la transition, puis décider de leur import ou de leur retrait |

## Décisions à prendre avant de coder

1. Fournisseur de stockage et région.
2. Logo public (URL stable) ou accès signé.
3. Logo du commerce dans les Wallets, ou logo Retiko conservé.
4. Sort des URL externes existantes.

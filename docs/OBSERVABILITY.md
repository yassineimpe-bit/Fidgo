# Observabilité production

Retiko utilise une stratégie simple et vérifiable avant le pilote : **Runtime Logs Vercel + synthetic monitoring GitHub Actions**. Le but est d'avoir une détection indépendante de Vercel sans ajouter un fournisseur d'observabilité supplémentaire tant que le volume produit ne le justifie pas.

## Signaux disponibles

### Erreurs serveur

Les erreurs serveur non gérées capturées par Next.js sont émises depuis `instrumentation.ts` sous :

`RETIKO_SERVER_ERROR`

Champs conservés :

- nom de l'erreur ;
- digest Next.js lorsqu'il existe ;
- méthode HTTP ;
- route ;
- chemin normalisé ;
- type de route ;
- version déployée.

### Erreurs navigateur

Les erreurs React côté client sont envoyées à `/api/client-errors`, puis émises sous :

`RETIKO_CLIENT_ERROR`

Le message brut n'est jamais envoyé aux logs. Une empreinte SHA-256 tronquée permet de regrouper les erreurs identiques sans conserver la saisie de l'utilisateur.

### Métriques API

Toutes les routes utilisant `withApiErrorHandling` émettent :

`RETIKO_API_METRIC`

Champs :

- `route` ;
- `status` ;
- `durationMs` ;
- `slow` ;
- `version`.

Une requête >= 1500 ms est écrite au niveau warning. Une réponse >= 500 est écrite au niveau error.

Cela permet notamment de suivre `SCAN`, `CREDIT`, `REDEEM` et les autres routes métier enveloppées sans journaliser de token de carte, identifiant client, email ou payload.

Exemples de recherches Vercel Runtime Logs :

- `RETIKO_API_METRIC` pour toutes les métriques ;
- `RETIKO_API_METRIC SCAN` pour le scanner ;
- `RETIKO_SERVER_ERROR` pour les crashes serveur ;
- `RETIKO_CLIENT_ERROR` pour les crashes navigateur.

### Santé runtime

`GET /api/health` vérifie notamment :

- configuration DB ;
- connexion PostgreSQL ;
- état du schéma et des contraintes critiques ;
- présence de `AUTH_SECRET` ;
- configuration HTTPS Wallet ;
- état Wallet Apple / Google ;
- état Stripe ;
- récupération email.

La réponse inclut aussi :

- `serverMs` ;
- `checkedAt`.

La version déployée (`VERCEL_GIT_COMMIT_SHA`) reste journalisée en interne via `RETIKO_HEALTH_OK/SLOW/DEGRADED`, mais n'est plus renvoyée dans le corps JSON public de `/api/health` : le dépôt étant public, exposer le commit exact en production faciliterait le repérage de la fenêtre entre la publication d'un correctif et son déploiement effectif.

Chaque appel produit l'un des signaux :

- `RETIKO_HEALTH_OK` ;
- `RETIKO_HEALTH_SLOW` si le health check >= 1000 ms ;
- `RETIKO_HEALTH_DEGRADED` si le service n'est pas prêt.

## Synthetic monitoring externe

Le workflow `.github/workflows/production-monitor.yml` appelle :

`https://retiko.fr/api/health`

toutes les **5 minutes**.

Il vérifie :

- HTTP 200 ;
- JSON valide ;
- `ok == true` ;
- service `retiko` ;
- DB `up` ;
- schéma `up` ;
- auth `up` ;
- HTTPS Wallet valide.

Le temps réseau total est enregistré dans le résumé du run.

### Gestion automatique des incidents

Si le monitor détecte un problème :

1. il ouvre l'issue GitHub `[monitoring] Retiko production incident` si aucune issue active n'existe ;
2. il y écrit le code HTTP, la latence et un diagnostic non sensible ;
3. le premier run de l'incident passe en échec afin de déclencher les notifications GitHub habituelles ;
4. les runs suivants ne créent pas de doublon.

Quand le health check redevient vert :

1. le workflow ajoute un commentaire de récupération ;
2. l'issue d'incident est fermée automatiquement.

Cette sonde est indépendante du runtime Vercel : une panne complète du déploiement reste donc visible depuis GitHub.

## Smoke tests complémentaires

`.github/workflows/production-smoke.yml` continue d'effectuer un contrôle plus lourd toutes les heures et après une CI réussie sur `main` :

- shell public ;
- contrat forgot-password ;
- headers de sécurité reset-password ;
- disponibilité complète de `/api/health`.

`.github/workflows/vercel-live-probe.yml` valide également la surface publique, les redirects et les assets PWA.

## Données exclues des logs

Les helpers d'observabilité suppriment ou ne journalisent jamais :

- mots de passe ;
- JWT ;
- tokens de carte ;
- liens de récupération ;
- emails ;
- query strings ;
- UUID client ;
- credentials fournisseur ;
- payload métier brut.

Un code d'erreur SQL ou symbolique peut être conservé. Les autres messages d'erreur sont remplacés par une empreinte courte.

## Runbook incident

Lorsqu'une issue `[monitoring] Retiko production incident` apparaît :

1. consulter le run GitHub lié ;
2. vérifier `/api/health` ;
3. dans Vercel Runtime Logs, rechercher `RETIKO_HEALTH_DEGRADED` puis `RETIKO_SERVER_ERROR` ;
4. si la DB est down, vérifier PostgreSQL et `DATABASE_URL` ;
5. si `schema == down`, vérifier les migrations de production ;
6. si l'API est verte mais lente, rechercher `RETIKO_API_METRIC` avec `slow: true` ;
7. pour un problème caisse, filtrer sur la route `SCAN`.

L'issue est fermée automatiquement dès récupération, mais la cause racine doit être documentée avant le pilote si l'incident était réel.

## Évolution après pilote

Si le volume ou les exigences SLA augmentent, brancher un drain Vercel vers un service dédié (Sentry, Datadog, Axiom, etc.) en conservant exactement la même politique de redaction et sans envoi automatique de données personnelles.

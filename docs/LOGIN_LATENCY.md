# Latence de connexion — mesures du 25/09/2026

Retour terrain : « connexion fonctionnelle mais ressentie comme un peu lente ».
Cette note mesure avant d'optimiser. **Aucune optimisation n'a été appliquée** :
le goulet est identifié, mais aucun correctif n'est à la fois sûr et évident.

## Méthode

- `scripts/bench-login.mjs` rejoue chaque phase de `POST /api/auth/login` sur
  une base locale, dans l'ordre de la route, puis mesure le parcours HTTP
  complet contre `next start` (build de production).
- Machine : Intel Xeon 2,1 GHz, 4 vCPU, PostgreSQL 16 local, Node 22.
- Mot de passe haché en bcrypt **coût 12** (valeur de production), bibliothèque
  `bcryptjs` 2.4.3 (JavaScript pur).

```bash
npm run build
DATABASE_URL=… AUTH_SECRET=… LOGIN_TIMING_LOG=1 npx next start -p 3100
DATABASE_URL=… node scripts/bench-login.mjs --runs 30 --url http://127.0.0.1:3100
```

## Résultats (30 connexions réussies)

| Phase | p50 | p95 |
|---|---:|---:|
| lecture / validation | 0,0 ms | 0,1 ms |
| rate limit IP (upsert) | 1,1 ms | 1,7 ms |
| lecture du compte | 0,5 ms | 1,0 ms |
| **bcrypt.compare (coût 12)** | **344,9 ms** | **358,1 ms** |
| contrôle du commerce | 1,1 ms | 1,4 ms |
| remise à zéro du compteur | 1,2 ms | 1,8 ms |
| signature JWT | 0,2 ms | 0,6 ms |
| **total** | **349,9 ms** | **362,5 ms** |
| HTTP complet | 366,8 ms | 407,2 ms |

bcrypt représente **98,6 %** du temps serveur. Les quatre requêtes SQL
cumulent environ 4 ms en local. Les pages ouvertes après connexion sont
rapides : `/dashboard` p50 26 ms, `/s` 13 ms, `/onboarding` 19 ms.

### Connexions simultanées sur une même instance

`bcryptjs` calcule dans la boucle d'événements Node : des connexions
simultanées sur le même processus s'additionnent.

| Simultanées | plus rapide | plus lente |
|---:|---:|---:|
| 1 | 425 ms | 425 ms |
| 2 | 371 ms | 730 ms |
| 5 | 749 ms | 1 881 ms |
| 10 | 3 638 ms | 3 646 ms |

Sur Vercel, si plusieurs requêtes partagent une instance (concurrence de la
fonction), une ouverture de caisse où plusieurs employés se connectent en même
temps peut dépasser la seconde.

## Ce que la mesure locale ne voit pas

- **Aller-retour base de production** : la connexion réussie fait 4 requêtes
  SQL **séquentielles** (rate limit, compte, commerce, remise à zéro). Chaque
  aller-retour Vercel `fra1` → Neon coûte la latence réseau réelle, inconnue
  tant que la région Neon n'est pas confirmée (voir `docs/LEGAL_STATUS.md`).
- **Réveil de Neon** : une base mise en veille après inactivité ajoute son
  temps de reprise à la première requête.
- **CPU Vercel** : bcrypt dépend directement de la puissance allouée à la
  fonction.

Pour mesurer en production sans rien exposer : définir `LOGIN_TIMING_LOG=1`
dans Vercel le temps du diagnostic. Chaque connexion écrit alors une ligne
`LOGIN_TIMING {"outcome":"success","parseMs":…,"rateLimitMs":…,"dbLookupMs":…,
"bcryptMs":…,"establishmentMs":…,"rateLimitResetMs":…,"sessionSignMs":…,
"totalMs":…}` dans les journaux serveur. Aucune durée n'est renvoyée au
navigateur ; aucun e-mail, identifiant ni IP n'est journalisé.

## Pistes, non appliquées

| Piste | Gain attendu | Pourquoi pas maintenant |
|---|---|---|
| Baisser le coût bcrypt (12 → 10) | ≈ 4× plus rapide (86 ms mesurés) | Affaiblit la résistance au cassage hors ligne : décision de sécurité, pas d'optimisation |
| bcrypt natif hors boucle d'événements (ex. `@node-rs/bcrypt`) | Calcul plus rapide et connexions simultanées non sérialisées ; hachages existants compatibles | Dépendance native à valider sur le runtime Vercel (build, bundle, démarrage à froid) avant tout déploiement |
| Joindre commerce et compte, remise à zéro après la réponse | − 2 allers-retours SQL | Gain local nul (≈ 2 ms) ; à décider d'après `LOGIN_TIMING` en production |
| Désactiver la mise en veille Neon | Supprime le réveil | Coût d'hébergement ; à décider d'après les journaux |

Recommandation : activer `LOGIN_TIMING_LOG=1` quelques jours en production.
Si `bcryptMs` domine, évaluer bcrypt natif dans une PR dédiée. Si ce sont
`rateLimitMs` et `dbLookupMs`, regrouper les requêtes ou revoir la région et la
mise en veille de Neon.

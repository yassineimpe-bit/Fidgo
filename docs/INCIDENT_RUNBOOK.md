# Runbook incident production Retiko

Ce document décrit la réponse minimale à un incident de production pendant le pilote. Il complète `DEPLOYMENT.md` et `OBSERVABILITY.md` sans remplacer les procédures propres à Vercel, Neon, Resend, Apple ou Google.

## 1. Priorités

Ordre de protection :

1. empêcher une corruption ou une double écriture supplémentaire ;
2. préserver les données et les preuves utiles au diagnostic ;
3. restaurer le cœur fidélité ;
4. restaurer les services secondaires (email, Wallet, analytics) ;
5. seulement ensuite corriger la cause racine.

Ne jamais improviser une migration en production pendant un incident. Ne jamais supprimer une branche Neon, une table, un déploiement ou des données pour « nettoyer » tant que la cause n'est pas comprise.

## 2. Niveaux d'incident

### P0 — arrêt ou intégrité menacée

Exemples :

- crédits ou redemptions incorrects ;
- suspicion cross-tenant ;
- double écriture non idempotente ;
- base indisponible ;
- authentification globale cassée ;
- fuite ou exposition d'un secret ;
- `/api/health` rouge avec `database`, `schema` ou `auth` indisponible.

Action : geler les changements, éviter toute nouvelle migration et traiter immédiatement.

### P1 — fonction importante dégradée

Exemples :

- scanner caméra cassé mais saisie manuelle disponible ;
- récupération email indisponible ;
- Apple/Google Wallet indisponible ;
- erreurs client en forte hausse sans corruption des données.

Action : conserver le fallback métier et corriger sans toucher aux invariants critiques.

### P2 — défaut non bloquant

Exemples :

- problème visuel ;
- métrique manquante ;
- lenteur ponctuelle sans erreur métier.

Action : ticket/PR normale.

## 3. Triage en 5 minutes

### A. Vérifier le domaine et le healthcheck

```bash
curl -I https://retiko.fr
curl -s https://retiko.fr/api/health | python3 -m json.tool
```

État attendu :

- `ok: true`
- `service: "retiko"`
- `database: "up"`
- `schema: "up"`
- `auth: "up"`
- `wallet.https: true`

### B. Vérifier le dernier changement

Contrôler :

- dernier commit de `main` ;
- dernière PR mergée ;
- dernier déploiement Vercel ;
- dernière migration appliquée ;
- changement récent de variable d'environnement.

Ne pas supposer que « dernier déploiement = cause ». Vérifier les logs et le moment exact du début des erreurs.

### C. Vérifier les logs

Rechercher d'abord :

- `RETIKO_SERVER_ERROR`
- `RETIKO_CLIENT_ERROR`
- erreurs PostgreSQL ;
- réponses HTTP 5xx ;
- erreurs d'authentification inhabituelles.

Ne jamais recopier dans un ticket public un secret, token de carte, lien de récupération, cookie de session ou connection string.

## 4. Décision rollback

### Rollback applicatif

Un rollback Vercel vers le dernier déploiement connu sain est approprié lorsque :

- le problème vient clairement du code applicatif ;
- le schéma de base reste compatible avec l'ancienne version ;
- aucune nouvelle écriture métier incompatible n'a été introduite.

Après rollback :

1. vérifier `/api/health` ;
2. tester login ;
3. tester scan ou code manuel ;
4. tester un crédit ;
5. tester une redemption si possible ;
6. surveiller les logs.

### Ne pas rollback automatiquement si une migration DB est impliquée

Si le nouveau code dépend d'une migration déjà appliquée, ou si la migration a modifié la forme des données, ne pas redéployer une ancienne version sans vérifier sa compatibilité.

Le principe Retiko reste :

- migration testée sur branche Neon temporaire ;
- vérification des données existantes ;
- migration production ;
- déploiement compatible ;
- healthcheck ;
- smoke métier.

## 5. Incident base de données

### Base joignable mais `schema: down`

- ne pas lancer `db:setup` aveuglément ;
- identifier précisément la contrainte/colonne/migration attendue ;
- comparer avec l'état réel de production ;
- tester la migration manquante sur un clone/branche temporaire ;
- appliquer uniquement après validation explicite.

### Suspicion de corruption métier

Arrêter les nouvelles modifications autant que possible et relever :

- période concernée ;
- établissements concernés ;
- cartes concernées ;
- transactions et reversals associés ;
- idempotency keys ;
- événements/audits correspondants.

Vérifier notamment :

- somme du ledger par carte ;
- cohérence avec `cards.balance` ;
- absence de références cross-tenant ;
- absence de double reversal ;
- absence de double redemption.

Ne pas corriger directement des soldes par `UPDATE` manuel sans produire un plan de réconciliation et une trace d'audit.

### Restauration

Utiliser les capacités de restauration/branching disponibles dans le compte Neon. Toujours restaurer ou inspecter d'abord dans une branche séparée lorsque c'est possible. Vérifier la fenêtre de restauration réellement disponible sur le plan Neon avant le pilote commercial.

Une restauration complète de production est une opération exceptionnelle : confirmer le point de restauration, les écritures qui seraient perdues et le plan de réconciliation avant promotion.

## 6. Incident auth ou secret

En cas de secret potentiellement exposé :

1. considérer le secret compromis ;
2. le révoquer/faire tourner côté fournisseur ;
3. remplacer la variable Vercel ;
4. redéployer ;
5. vérifier les logs d'accès disponibles ;
6. documenter la période d'exposition.

Pour `AUTH_SECRET`, une rotation invalide les sessions existantes. Prévoir donc une reconnexion des commerçants.

Ne jamais commiter le nouveau secret dans GitHub.

## 7. Dégradation des services secondaires

### Resend indisponible

Le cœur fidélité doit continuer à fonctionner. Désactiver temporairement la récupération email si nécessaire plutôt que de bloquer scan/crédit/redemption.

### Apple ou Google Wallet indisponible

La carte web/PWA reste le fallback permanent. Une panne Wallet ne doit jamais empêcher l'accès au compte fidélité ni le scan du QR Retiko.

### Scanner caméra indisponible

La saisie du code court/email reste le fallback commerçant. Si ce fallback fonctionne, classer l'incident P1 plutôt que P0 sauf effet métier supplémentaire.

## 8. Smoke après correction

Minimum avant de déclarer l'incident clos :

1. `/api/health` vert ;
2. page publique accessible ;
3. login Owner ;
4. scan QR ou code manuel ;
5. crédit ;
6. nouveau scan après cooldown attendu ;
7. redemption ;
8. annulation d'une transaction ;
9. logout/login ;
10. vérification des logs sans nouvelle erreur anormale.

Pour un changement touchant les permissions, ajouter un test EMPLOYEE/MANAGER. Pour un changement DB, relancer `db:verify` sur l'environnement approprié.

## 9. Après incident

Créer une note courte avec :

- heure de début et de fin ;
- impact réel ;
- cause racine ;
- mesure de mitigation ;
- correctif permanent ;
- test ajouté pour empêcher la régression ;
- action d'exploitation éventuelle.

Une correction sans test de non-régression n'est pas considérée terminée pour un P0/P1 reproductible.

## 10. Vérifications avant ouverture du pilote

À valider explicitement avant les premiers commerces :

- notifications GitHub Actions activées pour les échecs du workflow `production-smoke` ;
- fenêtre de restauration Neon connue ;
- accès Vercel et Neon disponible depuis au moins deux appareils/comptes de secours si l'organisation le permet ;
- procédure de rotation des secrets connue ;
- fallback scanner manuel vérifié ;
- contacts/support pilote définis ;
- dernier smoke métier daté et réussi.

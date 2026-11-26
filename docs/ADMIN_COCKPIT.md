# Cockpit super-admin (#230)

Vue interne Retiko pour piloter les premiers commerçants : `/admin`, `/admin/establishments`, `/admin/establishments/[id]`.

## Accès

- Compte staff Retiko normal + ligne dans `platform_admins`, revérifiée à chaque chargement.
- `/admin` sans session super-admin (aucune session, ou session commerçant ordinaire) affiche la connexion « Retiko · Super-admin » (#256) ; les sous-pages restent en 404.
- Connexion : mêmes identifiants et même 2FA que l'espace commerçant (`POST /api/auth/login` avec `scope: "admin"`). Un compte hors `platform_admins` reçoit `INVALID_CREDENTIALS`, comme un mauvais mot de passe, et compte dans les mêmes limites de débit (IP et compte) que `/login`. Avec la 2FA, le contexte admin est signé dans le jeton d'attente et `platform_admins` est revérifié après le code. Succès journalisé `ADMIN_LOGIN` (méthode seulement).
- `requirePlatformAdmin()` dans chaque page, consultation journalisée (`ADMIN_VIEW`, filtres compris) dans `platform_admin_audit` (append-only).
- Attribution hors application uniquement, avec accès direct à la base :

```sh
npm run admin:platform -- list
npm run admin:platform -- grant <email> "Fondateur Retiko"
npm run admin:platform -- revoke <email> "<motif>"
```

Le cockpit n'ajoute aucune route API ni mutation. La seule action reste la suspension / réactivation existante.

## Confidentialité

Le cockpit n'affiche que des agrégats par commerce. Il n'affiche jamais :

- l'e-mail, le téléphone ou le prénom d'un client ;
- une note client ;
- un token de carte ou un code court ;
- un identifiant ou un message d'erreur Wallet ;
- le contenu d'une transaction.

L'e-mail des comptes staff reste visible, comme avant. L'E2E `platform-admin-cockpit` vérifie l'absence de ces valeurs dans le HTML.

## Définitions

Source unique : `lib/platform-metrics.ts`, dont les formules sont partagées avec `/dashboard/analytics`.

| Indicateur | Définition |
| --- | --- |
| Commerce actif 24 h / 7 j / 30 j | au moins une transaction `earn` sur la période (un `adjust`, `reversal` ou `redeem` seul ne compte pas) |
| Commerce activé | au moins un `earn` depuis l'inscription ; taux = activés / inscrits |
| Délai d'activation | médiane de (premier `earn` − création du commerce), sur les commerces activés |
| Commerce récurrent 7 j | `earn` sur au moins 2 jours calendaires distincts (Europe/Paris) sur les 7 derniers jours |
| Onboarding terminé | `onboarding_step = 5`. Les commerces antérieurs au parcours guidé (`onboarding_step` NULL) ne sont pas suivis et sont comptés à part |
| Programme actif | `loyalty_programs.active`. Le programme est créé à l'inscription, donc « programme créé » n'apporte aucune information |
| Client actif 30 j | carte avec au moins un `earn` sur 30 j (même définition que l'analytics commerçant) |
| Client revenu | client actif crédité sur au moins 2 jours distincts (Europe/Paris) sur 30 j ; taux de retour = revenus / actifs |
| Nouveaux clients | clients non effacés créés sur 30 j |
| Récompenses utilisées | transactions `redeem` sur 30 j |
| Récompenses disponibles | cartes actives, client non effacé, programme actif, solde ≥ seuil (instantané) |
| Taux d'utilisation des récompenses | utilisées / (utilisées + disponibles) |
| Taux d'échec scanner | `SCAN_FAILED` / (`SCAN_SUCCESS` + `SCAN_FAILED`) dans `product_events` |
| p95 scanner | 95e centile continu de `duration_ms` des `SCAN_SUCCESS` (QR détecté → fiche client) |
| Wallet | passes `active` par fournisseur, passes `error` |

Un dénominateur nul s'affiche « — », jamais `NaN` ni 0 %.

## Règles « À surveiller »

Les règles sont déterministes et ne portent que sur les commerces ouverts (`status = 'active'`). Elles ne déclenchent aucune action automatique.

| Règle | Condition |
| --- | --- |
| Jamais démarré | inscrit depuis plus de 3 j, aucun `earn` |
| Décrochage | au moins un `earn` par le passé, aucun depuis ≥ 7 j |
| Essai à risque | abonnement `trial` se terminant dans moins de 7 j, aucun `earn` sur 7 j |
| Scanner | au moins 10 tentatives sur 7 j, dont au moins 20 % d'échecs |

Justification du seuil scanner : en dessous de 10 tentatives, deux ou trois échecs de cadrage suffisent à dépasser 20 %.

Dans la vue d'ensemble, l'aperçu affiche 30 commerces. Ordre de priorité : essai à risque, scanner, décrochage, jamais démarré. La liste complète est accessible avec `/admin/establishments?watch=1`.

## Performances

Tous les indicateurs viennent d'une seule requête de CTE (`establishmentUsage`). Elle fait une agrégation groupée par table, sans sous-requête par commerce. Les `count(distinct …)` ont été remplacés par des regroupements successifs `(commerce, carte, jour)` : ils forçaient un tri sur disque.

Mesures locales (PostgreSQL 16, `work_mem` par défaut) sur 300 commerces, 60 000 cartes, 1,2 M transactions et 300 000 événements scanner :

| Requête | Avant | Après |
| --- | --- | --- |
| Liste filtrée (`watch=1`) | 5,6 s | 1,6 s |
| Vue d'ensemble (une passe) | — | environ 0,7 à 1,6 s |
| Fiche commerce (index `establishment_id`) | — | 35 ms |

Aucun index n'est ajouté. Le coût restant est l'agrégation de tout l'historique (premier / dernier passage, totaux), une lecture séquentielle linéaire du ledger. Au volume du pilote, il est de quelques millisecondes.

Au-delà de quelques millions de transactions, la solution serait un agrégat quotidien persistant, et non un index.

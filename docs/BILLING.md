# Facturation Stripe v2

La facturation est indépendante du cœur fidélité. `STRIPE_ENABLED=false` est la valeur par défaut : inscription commerce, QR, scanner, cartes, transactions et dashboard métier restent opérationnels sans Stripe.

## Offres

Grille publique (`standard`, proposée par défaut) :

| Offre | Prix commercial | Price Stripe attendu | Périodicité |
|---|---:|---|---|
| Retiko mensuel | 25 € HT/mois, sans engagement, résiliable | `STRIPE_PRICE_STANDARD_MONTHLY` | mensuelle |
| Retiko annuel | 250 € HT/an, payé d’avance | `STRIPE_PRICE_STANDARD_ANNUAL` | annuelle |

Anciennes offres pilotes (`pilot`), conservées pour reconnaître les abonnés qui y sont rattachés :

| Offre | Prix commercial | Price Stripe attendu | Périodicité |
|---|---:|---|---|
| Retiko Flex | 24,99 € HT/mois, sans engagement | `STRIPE_PRICE_FLEX_MONTHLY` | mensuelle |
| Retiko 12 | 19,99 € HT/mois, engagement 12 mois | `STRIPE_PRICE_RETIKO12_MONTHLY` | mensuelle |
| Retiko annuel | 210 € HT/an | `STRIPE_PRICE_ANNUAL` | annuelle |

### Grilles tarifaires

Deux grilles coexistent dans `lib/billing-plans.ts` :

| Grille | Offres | Price Stripe attendu |
|---|---|---|
| `pilot` | Retiko Flex 24,99 € HT/mois, Retiko 12 19,99 € HT/mois, Retiko annuel 210 € HT/an | `STRIPE_PRICE_FLEX_MONTHLY`, `STRIPE_PRICE_RETIKO12_MONTHLY`, `STRIPE_PRICE_ANNUAL` |
| `standard` (défaut) | Retiko mensuel 25 € HT/mois sans engagement (`STANDARD_MONTHLY`), Retiko annuel 250 € HT/an payé d’avance (`STANDARD_ANNUAL`) | `STRIPE_PRICE_STANDARD_MONTHLY`, `STRIPE_PRICE_STANDARD_ANNUAL` |

`BILLING_PRICE_GRID` (`standard` par défaut, `pilot` sur choix explicite ; toute autre valeur est refusée par `env:check`) choisit les offres proposées aux **nouvelles** souscriptions, sur le site, dans les CGV et dans *Facturation*. Chaque offre a sa propre clé et son propre Price : un abonné pilote reste reconnu par le webhook et garde son prix quand la grille passe à `standard` (Stripe ne modifie jamais le Price d'un abonnement existant). Une offre qui n'appartient pas à la grille proposée est refusée par Checkout (`INVALID_PLAN`).

Seuls les Prices de la grille proposée sont exigés par `env:check` et par l'état d'exécution ; ceux de l'ancienne grille doivent rester configurés tant que des abonnés y sont rattachés. Tous les Price IDs configurés doivent être distincts.

La grille standard est la grille exposée par défaut (site, CGV, *Facturation*). Tant que `STRIPE_ENABLED=false`, ce choix ne change que l'affichage. **Avant d'ouvrir le paiement** avec cette grille : migration `029_billing_price_grids.sql` appliquée (sinon Checkout répond `503 BILLING_SCHEMA_OUTDATED`), les deux Prices créés dans Stripe, CGV validées juridiquement, puis redéploiement. Un environnement qui doit encore proposer les anciens tarifs le déclare explicitement avec `BILLING_PRICE_GRID=pilot`.

### Offre Fondateurs (non implémentée)

Offre commerciale décidée : 19 € HT/mois pendant 24 mois pour les 20 premiers commerces de Corrèze, puis 25 € HT/mois, sans engagement. Elle n'existe pas dans le code de facturation et n'est affichée nulle part : elle se conclut aujourd'hui par proposition commerciale écrite, que les CGV (§ 4) font prévaloir sur la grille publique pour le client concerné.

Correctif minimal le jour où le paiement en ligne s'ouvre pour ces commerces : un coupon Stripe (réduction de 6 € HT/mois, durée 24 mois) appliqué sur le Price `STANDARD_MONTHLY` à la création de la Checkout Session, réservé aux commerces marqués éligibles côté serveur. Aucune nouvelle offre ni nouveau Price : à 24 mois, Stripe revient seul à 25 € HT/mois et l'historique reste sur `STANDARD_MONTHLY`. À ne pas coder avant la décision d'ouvrir Stripe.

Les montants et la fiscalité doivent être configurés dans Stripe Dashboard. Le navigateur envoie uniquement une clé d’offre de la grille proposée (`STANDARD_MONTHLY`, `STANDARD_ANNUAL`, ou `FLEX`, `RETIKO_12`, `ANNUAL` en grille pilote) ; le serveur choisit le Price ID correspondant. Un `priceId` fourni par le client est rejeté.

Checkout exige l’adresse de facturation et active la collecte de l’identifiant fiscal lorsque Stripe le propose au client. Pour un Customer Stripe déjà lié, l’adresse saisie est recopiée sur le Customer afin de garder ses données de facturation à jour. Cela prépare les données nécessaires à la facturation B2B, mais **n’active pas à lui seul le calcul automatique de TVA** : `automatic_tax` reste volontairement désactivé tant que les immatriculations fiscales et le traitement TVA de Retiko n’ont pas été validés.

Le pilote initial est enregistré localement pour environ 30 jours. Le signup ne contacte jamais Stripe et ne redirige pas automatiquement vers Checkout. Si Checkout est lancé pendant le pilote, sa date de fin existante est transmise à Stripe lorsqu’elle respecte encore le minimum accepté par Stripe; elle n’est jamais prolongée par un nouvel essai.

## Limite de l’engagement Retiko 12

Un Price mensuel Stripe ne garantit pas, à lui seul, un engagement contractuel de 12 mois si le Customer Portal autorise une résiliation immédiate ou en fin de période. Cette version n’invente donc pas de verrou applicatif fragile et ne bloque jamais la fidélité sur la base du paiement.

Avant d’activer Retiko 12, il faut choisir et valider avec l’exploitation/commercial l’un des mécanismes suivants : configuration dédiée du portail sans résiliation libre pendant l’engagement, contrat commercial et traitement opérationnel des résiliations, ou modélisation Stripe Billing/Schedules validée sur un compte test. La promesse commerciale de 12 mois doit rester explicite dans les CGV et dans la configuration Stripe retenue.

## Variables d’environnement

```text
STRIPE_ENABLED=false
STRIPE_AUTOMATIC_TAX_ENABLED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
BILLING_PRICE_GRID=standard
STRIPE_PRICE_STANDARD_MONTHLY=
STRIPE_PRICE_STANDARD_ANNUAL=
STRIPE_PRICE_FLEX_MONTHLY=
STRIPE_PRICE_RETIKO12_MONTHLY=
STRIPE_PRICE_ANNUAL=
```

Aucune clé publiable Stripe n’est nécessaire : Retiko utilise Checkout et Customer Portal hébergés par Stripe. Aucun secret ni Price ID n’est envoyé dans le HTML.

Lorsque `STRIPE_ENABLED=true`, `npm run env:check` exige une clé `sk_`, un secret `whsec_` et les Price IDs `price_` de la grille proposée, tous distincts. `STRIPE_AUTOMATIC_TAX_ENABLED` reste indépendant et vaut `false` tant que la configuration fiscale n'est pas validée ; le passer à `true` active `automatic_tax` sur les nouvelles Checkout Sessions sans nécessiter un nouveau déploiement de code.

## Parcours et isolation

1. Le signup crée le commerce, l’Owner, le programme et une ligne `subscriptions` en statut `trial` dans une seule transaction PostgreSQL.
2. `/dashboard/billing` est réservé au rôle `OWNER`.
3. `/api/billing/checkout` relit l’abonnement uniquement avec `session.establishmentId`, détermine le Price côté serveur et utilise une clé d’idempotence Stripe limitée au tenant et à l’offre.
4. `/api/billing/portal` relit également le client Stripe dans le tenant de la session.
5. `/api/billing/webhook` lit le corps brut, vérifie obligatoirement `stripe-signature`, puis traite l’événement dans une transaction DB.
6. Une réservation atomique en base empêche deux requêtes Checkout concurrentes de créer deux abonnements. La session Checkout créée est enregistrée avant d'être rendue au navigateur et expire avant que la réservation puisse être reprise.
7. Le webhook lie un Checkout au tenant via cet identifiant de session enregistré côté serveur. Les metadata Stripe ne sont utilisées que comme contrôle de cohérence, jamais comme preuve suffisante d'identité tenant.
8. `stripe_webhook_events.event_id` empêche un rejeu. `stripe_last_event_created` et `stripe_last_event_id` empêchent un événement ancien de remplacer un état plus récent.
9. Une liaison existante customer/subscription ne peut pas être réaffectée à un autre établissement. Les identifiants externes et les sessions Checkout ont des index uniques.

Les statuts locaux sont `trial`, `active`, `past_due`, `canceled` et `unpaid`. `incomplete` et `incomplete_expired` sont ramenés à `unpaid`; `paused` à `past_due`. Les dates conservées sont la fin de pilote/essai et la fin de période courante.

La table ne stocke ni numéro de carte, ni moyen de paiement, ni payload webhook complet. Les logs applicatifs ne contiennent que des codes d’erreur expurgés et le type d’événement.

## Configuration humaine Stripe Dashboard

1. Utiliser d’abord le mode test Stripe.
2. Créer un produit Retiko et trois Prices récurrents en EUR : 24,99 € mensuel, 19,99 € mensuel, 210 € annuel.
3. Vérifier que les prix sont exprimés HT. Checkout collecte déjà l’adresse de facturation et l’identifiant fiscal ; configurer ensuite Stripe Tax/TVA et les immatriculations fiscales conformément au cadre validé pour Retiko avant d’activer `automatic_tax`.
4. Reporter les trois `price_...` dans les variables correspondant exactement aux offres.
5. Activer et configurer Customer Portal. Décider séparément du traitement de l’engagement Retiko 12 avant de permettre la résiliation libre.
6. Créer l’endpoint `https://retiko.fr/api/billing/webhook` avec au minimum :
   - `checkout.session.completed`;
   - `customer.subscription.created`;
   - `customer.subscription.updated`;
   - `customer.subscription.deleted`.
7. Copier le secret de signature de cet endpoint dans `STRIPE_WEBHOOK_SECRET`.
8. Appliquer `013_stripe_billing_v2.sql` sur la base ciblée, exécuter `npm run db:verify`, puis déployer le code.
9. Tester entièrement en mode test Stripe. N’activer `STRIPE_ENABLED=true` en production qu’après validation des offres, de la TVA, du portail et des webhooks.

Cette mission ne doit appliquer aucune migration ni activer Stripe en production.

## Exploitation

Les événements traités ne conservent pas leur payload. La table d’idempotence peut être purgée manuellement par lots après une durée supérieure à la fenêtre de rejeu Stripe retenue par l’exploitation; aucune purge automatique n’est ajoutée ici afin de ne pas réduire silencieusement la protection contre les doublons.

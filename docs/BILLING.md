# Facturation Stripe

Fidgo facture une offre commerciale unique : pas de paliers fonctionnels (STARTER/PRO/PREMIUM), un seul produit avec deux fréquences de paiement.

- **29 € HT / mois**, sans engagement.
- **290 € HT / an**.
- **30 jours d'essai gratuit** avant le premier prélèvement, quel que soit le rythme choisi.
- Des codes promo (offres fondateurs, remises pilote) sont activables directement dans Stripe grâce à `allow_promotion_codes`, sans créer de nouveau palier.

Le rythme (mensuel/annuel) est choisi à l'inscription (`/signup`) et enregistré dans `subscriptions.billing_interval`.

## Mode par défaut : désactivé

Comme pour Apple/Google Wallet, la facturation reste **prête à activer** mais désactivée tant que `STRIPE_ENABLED` n'est pas `true`. Sans Stripe configuré :
- l'inscription crée quand même une ligne `subscriptions` en statut `trial` (30 jours), sans aucun appel à Stripe ;
- le tableau de bord `/dashboard/billing` affiche que la facturation n'est pas encore activée et que l'accès reste gratuit pendant le pilote ;
- aucune route API Stripe (`/api/billing/*`) n'accepte de requête tant que `STRIPE_ENABLED` n'est pas actif.

## Activation

Pré-requis externes :
1. créer un compte Stripe (ou utiliser le compte existant) ;
2. créer un produit « Fidgo » avec deux Prices récurrents : mensuel et annuel ;
3. créer un endpoint de webhook Stripe pointant vers `https://<domaine>/api/billing/webhook`, écoutant au minimum :
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. activer le Customer Portal Stripe (gestion moyen de paiement / résiliation).

Variables :
- `STRIPE_ENABLED=true`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MONTHLY`
- `STRIPE_PRICE_ANNUAL`

## Parcours

1. `/signup` : le restaurateur choisit mensuel ou annuel. Le compte, le commerce et une ligne `subscriptions` (`status='trial'`) sont créés immédiatement, avant tout appel Stripe.
2. Si Stripe est configuré, l'API crée une Checkout Session (`mode: subscription`, `trial_period_days: 30`) et redirige le navigateur dessus pour la saisie de la carte. Un échec Stripe à cette étape n'empêche pas la création du compte : l'utilisateur atterrit sur `/dashboard` et pourra relancer le paiement depuis `/dashboard/billing`.
3. Le webhook Stripe tient `subscriptions` à jour : identifiants externes, statut (`trial`/`active`/`past_due`/`cancelled`), date de fin de période, résiliation programmée.
4. `/dashboard/billing` permet au propriétaire de démarrer le paiement (`/api/billing/checkout`) s'il n'a pas encore de client Stripe, ou d'ouvrir le Customer Portal (`/api/billing/portal`) pour gérer/résilier une fois le client créé.

## Sécurité

- `/api/billing/checkout` et `/api/billing/portal` exigent une session `OWNER`/`MANAGER` et une origine same-site, comme les autres routes mutantes du dashboard.
- `/api/billing/webhook` n'exige pas de same-origin (Stripe appelle depuis ses propres serveurs) mais vérifie la signature `stripe-signature` avec `STRIPE_WEBHOOK_SECRET` avant tout traitement.
- Aucune clé Stripe n'est jamais renvoyée au client ; seules des URLs de redirection Stripe (Checkout, Portal) transitent par l'API.

# Retiko V0
## Cahier des charges pré-pilote et lancement commercial

### 1. Objectif de la V0

Retiko doit permettre à un **commerce indépendant de proximité** de lancer un programme de fidélité numérique utilisable par de vrais clients, sans application native obligatoire et sans matériel supplémentaire.

La V0 est validée lorsque :

> **Un commerçant qui ne connaît pas Retiko peut créer son compte, configurer son programme, imprimer son QR, installer Retiko sur son téléphone, inscrire un vrai client, scanner sa carte, créditer un passage ou un achat, atteindre puis consommer une récompense sans aide technique.**

Pendant les premiers pilotes, Retiko peut être présent au premier service. L’autonomie reste cependant un critère de qualité du produit : le commerçant doit ensuite pouvoir utiliser Retiko sans accompagnement quotidien.

Positionnement commercial retenu :

> **Retiko, la fidélité digitale simple pour les commerces de proximité.**

Retiko n’est donc plus positionné uniquement comme un produit pour la restauration.

Verticales prioritaires :

```text
snacks / fast-food indépendants
coffee shops
boulangeries
restaurants à clientèle récurrente
coiffeurs / barbiers
boucheries
poissonneries
fromageries
petits commerces alimentaires spécialisés
```

---

# 2. Boucle produit de référence

La boucle à rendre parfaite avant toute autre fonctionnalité est :

```text
Commerçant
      ↓
Création du compte
      ↓
Configuration du commerce
      ↓
Configuration du programme
      ↓
QR d'inscription imprimé
      ↓
Client scanne
      ↓
Création de sa carte
      ↓
Carte web / PWA
      ↓
Commerçant scanne le QR client
      ↓
Crédit fidélité
      ↓
Solde client mis à jour automatiquement
      ↓
Récompense atteinte
      ↓
Récompense utilisée
      ↓
Transaction enregistrée et mesurable
```

Apple Wallet et Google Wallet ne sont **pas des dépendances de cette boucle pour le premier pilote**.

---

# 3. Modèles de fidélité métier

Retiko doit rester générique, tout en proposant des configurations adaptées aux principaux métiers.

## Tampons / passages

Pertinent notamment pour :

```text
snacks
coffee shops
boulangeries
coiffeurs
barbiers
```

Exemples :

```text
8 menus = 1 menu offert
10 achats = 1 produit offert
5 coupes = 1 avantage fidélité
```

## Points selon montant dépensé

Pertinent notamment pour :

```text
boucheries
poissonneries
fromageries
commerces avec paniers très variables
```

Exemple :

```text
1 € dépensé = 1 point
500 points = 10 € de récompense
```

Le commerçant reste libre de modifier les paramètres proposés.

À terme, l’onboarding pourra proposer un modèle par type de commerce, sans créer plusieurs produits Retiko distincts.

---

# 4. P0 : infrastructure de production

Avant tout pilote, la production doit être réellement exploitable.

| Élément | Exigence |
|---|---|
| Vercel | production fonctionnelle |
| Neon | base principale connectée |
| HTTPS | obligatoire |
| `DATABASE_URL` | configurée |
| `AUTH_SECRET` | configuré |
| migrations | à jour |
| auth | fonctionnelle |
| `/api/health` | vert |
| PWA | testée sur appareil réel |
| domaine définitif | `https://retiko.fr` |

Le healthcheck attendu doit indiquer au minimum :

```json
{
  "ok": true,
  "service": "retiko",
  "database": "up",
  "schema": "up",
  "auth": "up"
}
```

Apple et Google peuvent encore être désactivés.

---

# 5. P0 : domaine définitif

Le domaine public définitif est :

```text
https://retiko.fr
```

Aucun support commercial ne doit utiliser l’ancien alias technique Vercel.

Le domaine définitif doit être utilisé pour :

```text
page d'inscription
carte web
API
PWA
liens de récupération
emails
futur web service Apple Wallet
```

Le QR imprimé doit pointer directement vers :

```text
https://retiko.fr/j/<commerce>
```

La redirection `www.retiko.fr` vers `retiko.fr` doit rester opérationnelle.

---

# 6. P0 : validation sur appareils physiques

Tests obligatoires :

| Environnement | Test |
|---|---|
| iPhone Safari | inscription + carte |
| iPhone PWA | connexion + caméra + scanner |
| Android Chrome | inscription + carte |
| Android PWA | connexion + caméra + scanner |

Pour la PWA commerçant :

```text
connexion
→ ajout à l'écran d'accueil
→ lancement via icône
→ éventuelle reconnexion
→ autorisation caméra
→ scan réel
→ crédit réel
```

Tester également :

```text
faible luminosité
écran client sombre
verre de protection
QR à différentes distances
plusieurs scans successifs
refus puis réactivation de la caméra
connexion mobile dégradée
```

La PWA scanner doit fonctionner avant toute prospection commerciale active.

---

# 7. P0 : scanner rush-safe

Le scanner doit fonctionner en situation réelle de service.

Après détection :

```text
CLIENT

8 / 10 tampons

[ +1 TAMPON ]

[ UTILISER LA RÉCOMPENSE ]
```

Objectifs :

| Mesure | Cible |
|---|---:|
| détection QR | < 500 ms idéal |
| QR → fiche client | < 1 s idéal |
| action → confirmation | < 1 s idéal |
| p95 parcours | < 2,5 s maximum pilote |

## Fallback manuel

La saisie du **code court** est obligatoire.

Exemple :

```text
Code client

[ 482913 ] [ Rechercher ]
```

Elle doit permettre de retrouver la carte même si :

```text
caméra indisponible
QR illisible
écran endommagé
luminosité mauvaise
```

L’email peut rester un mode secondaire réservé au staff autorisé.

## Feedback immédiat

Après crédit :

```text
✓ +1 tampon

9 / 10

Dernier passage : à l'instant
```

Le retour doit être :

```text
visuel
sonore
haptique
```

La récompense débloquée doit avoir un retour distinct.

---

# 8. P0 : anti double-crédit

La protection repose sur :

```text
idempotency_key
+
cooldown
+
interface
+
audit
```

Cooldown par défaut des **nouveaux** programmes :

```text
10 minutes
```

(2 minutes jusqu'au retour terrain du 25/09/2026 ; les programmes existants
gardent leur valeur, aucune migration ne la réécrit). Le commerçant choisit
librement : 2, 5, 10, 15 minutes ou une valeur personnalisée en secondes.

Si la carte est encore dans le délai, le scanner l'affiche dès l'ouverture :

```text
Crédit récent détecté
Temps restant : 7 min 42 s
```

Un `OWNER` ou `MANAGER` peut utiliser :

```text
Nouvel achat : autoriser un nouveau crédit
```

après la confirmation « Confirmer qu’il s’agit d’un nouvel achat effectué par
le client ? ». Le crédit passe par le dépassement de cooldown existant
(`expectedLastEarnAt`, refus d'un état périmé) et est audité (`CARD_ADJUSTED`)
avec le motif système `NEW_PURCHASE_CONFIRMED`, sans donnée personnelle.
Un `EMPLOYEE` voit le délai mais ne peut pas le dépasser.

---

# 9. P0 : ajustement manuel et procédure de rattrapage

Le dashboard doit permettre :

```text
recherche par code court
→ ouverture client
→ ajuster solde
→ saisir motif
→ confirmer
```

Une modification manuelle doit toujours produire un audit `CARD_ADJUSTED` avec au minimum :

```text
staff_user_id
card_id
ancien solde
nouveau solde ou delta
motif
date
```

Cette fonction est indispensable au plan de continuité du pilote.

---

# 10. P0 : carte web client

La carte `/c/{token}` constitue la référence V0.

Elle doit afficher :

| Information | Obligatoire |
|---|---|
| commerce | ✅ |
| identité visuelle | ✅ |
| prénom | ✅ |
| QR | ✅ |
| code court | ✅ |
| solde | ✅ |
| seuil | ✅ |
| progression | ✅ |
| récompense | ✅ |
| récompense disponible | ✅ |

La carte doit rester parfaitement exploitable sans Apple Wallet ni Google Wallet.

---

# 11. P0 : rafraîchissement automatique du solde

Lorsque la carte reste affichée au comptoir, le client doit voir son nouveau solde sans actualisation manuelle.

Endpoint léger :

```text
/api/card/{token}/status
```

Politique V0 :

```text
carte visible
→ polling toutes les 3 secondes
```

Lorsque la page n’est plus visible :

```text
polling suspendu
```

Après environ 5 minutes sans interaction :

```text
polling arrêté
→ bouton Actualiser mon solde
```

---

# 12. P0 : récupération de carte

Le stockage local est uniquement un confort.

## Même navigateur

Si Retiko reconnaît localement une carte du commerce :

```text
Vous avez déjà une carte Retiko

[ Ouvrir ma carte ]
```

## Récupération email

Elle est obligatoire avant une prospection large.

Prérequis :

```text
retiko.fr
→ Resend
→ EMAIL_FROM
→ EMAIL_REPLY_TO
→ CARD_RECOVERY_ENABLED=true
```

Mécanisme :

```text
token aléatoire 256 bits
→ hash stocké en DB
→ expiration 15 minutes
→ usage unique
```

---

# 13. Anti-énumération récupération

Une demande de récupération ne doit jamais révéler si une adresse possède une carte.

Réponse publique unique :

> Si cette adresse est associée à une carte, vous allez recevoir un lien pour la retrouver.

Le statut HTTP, la structure de réponse et le comportement observable doivent rester aussi uniformes que raisonnablement possible.

---

# 14. P1 avant prospection : onboarding commerçant

Objectif :

```text
< 5 minutes
```

entre création du compte et premier QR fonctionnel.

Parcours :

| Étape | Action |
|---:|---|
| 1 | compte |
| 2 | type de commerce |
| 3 | commerce / identité visuelle |
| 4 | modèle proposé : tampons ou points |
| 5 | seuil et récompense |
| 6 | QR |
| 7 | installation PWA |
| 8 | premier scan test |

Exemples de préconfiguration :

```text
Boulangerie → 10 achats = 1 produit offert
Snack → 8 passages = 1 avantage
Coiffeur → 5 visites = 1 récompense
Boucherie → points selon montant
Fromagerie → points selon montant
Poissonnerie → points selon montant
```

Ces valeurs restent modifiables.

---

# 15. QR et support pilote

L’affiche A4 est obligatoire avant le pilote.

Elle comporte :

```text
logo commerce
nom
promesse fidélité
récompense
QR
URL courte éventuelle
```

Exemple :

```text
VOTRE FIDÉLITÉ
SUR VOTRE TÉLÉPHONE

[ avantage du commerce ]

[ QR ]

Scannez pour obtenir votre carte
```

Le QR pointe exclusivement vers `retiko.fr`.

Les formats A5, sticker, chevalet et réseaux sociaux peuvent suivre après validation terrain.

---

# 16. P0 : instrumentation du pilote

Événements minimum :

```text
JOIN_PAGE_VIEW
JOIN_SUBMIT
SCAN_SUCCESS
SCAN_FAILED
CREDIT_SUCCESS
REWARD_REDEEMED
```

`SCAN_SUCCESS` doit enregistrer `durationMs` sans token brut, email ou secret.

Les transactions existantes restent la source de vérité pour :

```text
passages
dates
cartes
récompenses
fréquence
```

---

# 17. KPI pilote produit

## Conversion client

```text
JOIN_SUBMIT / JOIN_PAGE_VIEW
```

## Performance scanner

Mesurer :

```text
p50
p95
taux d'erreur
fallback code court
```

## Retour client

```text
cartes ayant des transactions sur au moins deux jours distincts
/
cartes ayant au moins une transaction
```

## Récompenses

```text
nombre de REWARD_REDEEMED
```

## Adoption commerce

Lorsque disponible :

```text
scans fidélité / tickets caisse
```

Le nombre de tickets peut être relevé depuis le Z de caisse ou fourni manuellement pendant le pilote.

---

# 18. KPI commerciaux

Dès les premières démarches commerciales, mesurer :

```text
prospects visités
prospects ayant accepté une démo
pilotes ouverts
pilotes réellement actifs
pilotes convertis en payant
délai moyen signature → activation
CAC cash
CAC incluant temps et déplacements
ARPU
part des abonnements annuels
churn
LTV lorsque suffisamment de recul existe
```

Le taux de conversion doit être suivi par secteur :

```text
boulangerie
snack
coiffeur / barber
boucherie
poissonnerie
fromagerie
restaurant
```

Le but est de découvrir rapidement quels métiers ont la meilleure combinaison :

```text
besoin perçu
facilité de vente
usage réel
rétention
rentabilité commerciale
```

---

# 19. Disponibilité opérationnelle

Chaque commerce pilote doit définir ses plages de service critiques.

Les métriques distinguent :

```text
indisponibilité totale
```

et :

```text
indisponibilité pendant les plages critiques
```

KPI :

```text
Disponibilité pendant services
=
temps opérationnel pendant plages critiques
/
temps total des plages critiques
```

---

# 20. Observabilité

Avant le premier pilote, Retiko doit disposer d’une remontée d’erreurs exploitable.

Capturer :

```text
exceptions serveur
erreurs frontend
échecs inattendus scanner
erreurs DB
erreurs Wallet
```

Contexte acceptable :

```text
route
version
browser
device
identifiant interne commerce
```

Jamais :

```text
password
JWT
token carte
clé privée
secret
```

`/api/health` doit également être surveillé.

---

# 21. Procédure d’incident pilote

En cas de panne :

```text
1. ne pas ralentir le service
2. noter le code court du client
3. noter l'opération attendue
4. continuer le service
5. régulariser dans Retiko plus tard
```

La régularisation passe par :

```text
dashboard
→ recherche code court
→ ajustement manuel
→ motif obligatoire
```

Pour les premiers pilotes :

```text
incident bloquant pendant service
→ prise en compte interne < 30 minutes lorsque possible
```

Ce n’est pas un SLA commercial.

---

# 22. RGPD pré-pilote

Pour les données du programme fidélité :

```text
Commerce = responsable du traitement
Retiko = sous-traitant
```

Retiko reste responsable de traitement pour ses propres données SaaS :

```text
compte commerçant
relation commerciale
facturation
support
```

Avant le premier pilote :

```text
politique de confidentialité
mentions légales
CGU
accord pilote
annexe sous-traitance
```

Le consentement marketing doit rester séparé du fonctionnement de la carte.

---

# 23. Accord pilote

Durée proposée :

```text
30 jours
```

Prix pendant le pilote :

```text
gratuit
```

Pour les premiers pilotes, **aucune carte bancaire n’est demandée au démarrage**.

Le document doit couvrir :

```text
objet du pilote
données traitées
rôles RGPD
durée
support
propriété des données
sous-traitants
absence d'engagement après pilote
conditions de fin
export / suppression
absence de garantie de disponibilité
relevé hebdomadaire du nombre de tickets si disponible
plages horaires critiques
```

---

# 24. Pilotes terrain

Nombre initial :

```text
1 à 3 commerces
```

Cibles prioritaires pour apprendre vite :

```text
snack / fast-food indépendant
boulangerie
coffee shop
coiffeur / barber
```

Cibles à intégrer rapidement ensuite :

```text
boucherie
poissonnerie
fromagerie
restaurant à clientèle régulière
```

Conditions idéales :

```text
clientèle récurrente
flux régulier
décideur présent
peu de hiérarchie
absence de programme digital moderne
ou carte papier actuellement utilisée
```

Le premier service est observé directement. Ensuite Retiko doit fonctionner sans intervention quotidienne.

---

# 25. Stratégie géographique de lancement

Le terrain initial est volontairement local.

## Phase 1

```text
Ussel / Haute-Corrèze / Corrèze
```

Objectif : proximité, faible coût de déplacement, observation facile des premiers pilotes et création de références locales.

## Phase 2

```text
Puy-de-Dôme
Clermont-Ferrand et agglomération
```

Objectif : augmenter fortement la densité de prospects une fois le pitch et le parcours pilote validés.

La Corrèze sert de laboratoire commercial. Elle ne constitue pas la limite géographique du produit.

---

# 26. Prospection initiale

Le canal prioritaire au départ est la **prospection physique directe**.

Pourquoi :

```text
produit démontrable en quelques minutes
contact direct avec le décideur
faible coût cash
retour immédiat sur les objections
possibilité d'activer un pilote sur place
```

Cadence de départ indicative :

```text
10 à 15 commerces visités par semaine
```

Avant la première vraie campagne, préparer au moins :

```text
50 prospects qualifiés
10 prospects prioritaires
3 profils de pilotes idéaux
```

Pour chaque prospect, suivre :

```text
nom
ville
secteur
responsable
contact
système de fidélité actuel
carte papier / digital / aucun
date de visite
intérêt
démo effectuée
pilote accepté
activation réelle
conversion payante
raison du refus
```

Le pitch doit partir du problème métier, pas de la technologie.

Exemple :

> Vous avez déjà un système de fidélité ? Retiko remplace la carte papier par une carte digitale accessible directement sur le téléphone du client, sans matériel supplémentaire et sans application obligatoire.

La démonstration complète doit tenir en environ 5 minutes.

---

# 27. Positionnement marketing

Promesse principale :

> **La fidélité digitale simple pour les commerces de proximité.**

Sous-promesse possible :

> Créez votre programme, affichez votre QR et commencez à fidéliser vos clients en quelques minutes.

Messages à privilégier :

```text
pas de carte plastique ou papier à perdre
pas de terminal supplémentaire
pas d'application client obligatoire
programme personnalisable
utilisable depuis un simple téléphone
```

Retiko ne doit pas être vendu comme « un QR code ». Le produit doit progressivement démontrer son impact sur :

```text
retour client
fréquence de visite
récompenses utilisées
engagement fidélité
```

---

# 28. Tarification de lancement

Tarification publique retenue :

## Retiko Flex

```text
24,99 € HT / mois
```

Sans engagement.

## Retiko 12

```text
19,99 € HT / mois
```

Avec engagement commercial de 12 mois. Un simple Price Stripe mensuel ne
garantit pas techniquement cet engagement : le mécanisme contractuel et la
configuration du Customer Portal doivent être validés avant activation.

## Offre annuelle

```text
210 € HT / an
```

Équivalent :

```text
17,50 € HT / mois
```

Les éventuelles offres « fondateur » doivent rester limitées aux premiers pilotes et ne doivent pas dégrader durablement le prix public.

---

# 29. Paiement intégré dans Retiko

Après validation du pilote, le paiement doit se faire directement depuis Retiko via Stripe.

Parcours cible :

```text
création du compte
↓
30 jours gratuits
↓
rappels avant fin d'essai
↓
choix de l'offre
↓
Retiko Flex à 24,99 € HT / mois sans engagement
ou Retiko 12 à 19,99 € HT / mois avec engagement commercial de 12 mois
ou offre annuelle à 210 € HT / an
↓
Stripe Checkout
↓
abonnement actif
```

Pour les pilotes initiaux, aucune carte n’est demandée au début de l’essai.

Stripe doit gérer autant que possible :

```text
paiement CB
récurrence
factures
reçus
échec de paiement
mise à jour du moyen de paiement
annulation
historique de facturation
```

Une section `Facturation` dans Retiko doit afficher au minimum :

```text
offre actuelle
statut abonnement
prochaine échéance
bouton Gérer mon abonnement
```

Le bouton doit ouvrir le Stripe Customer Portal ou équivalent.

---

# 30. Fin d’essai gratuit

À la fin des 30 jours, si aucun abonnement n’est souscrit :

```text
statut = TRIAL_EXPIRED
```

Les données ne sont pas supprimées immédiatement.

Le commerçant peut encore :

```text
se connecter
voir son dashboard
voir ses données existantes
accéder à la facturation
reprendre un abonnement
```

Les fonctions opérationnelles peuvent être suspendues :

```text
nouveaux crédits
scanner opérationnel
nouvelles inscriptions
récompenses consommées
```

Un bandeau clair doit inviter à activer l’abonnement.

Objectif : permettre une conversion tardive sans obliger le commerce à recommencer sa configuration.

---

# 31. Wallet

Pour la V0 :

```text
carte web = produit fonctionnel
PWA = accès rapide
Wallet = confort et rétention
```

Apple Wallet et Google Wallet peuvent être activés pendant ou après les premiers pilotes.

Ils ne bloquent ni le premier pilote ni le début de la prospection.

Mesures utiles :

```text
nombre d'ajouts Wallet
problèmes observés
usage réel
feedback client
feedback commerce
```

---

# 32. Ce qui reste hors lancement initial

Pour éviter de transformer Retiko en ERP avant d’avoir validé les ventes :

| Fonctionnalité | Moment |
|---|---|
| analytics avancées | après données terrain |
| campagnes marketing automatisées | après pilote |
| segmentation client avancée | après pilote |
| multi-établissements avancé | après demande réelle |
| admin avancé | après pilote |
| permissions extrêmement granulaires | après besoin réel |
| MFA | V1 |
| PIN caisse | selon retour |
| API publique | plus tard |
| BI avancée | avec vraies données |
| intégrations caisse/POS | après validation commerciale |

L’intégration caisse peut devenir stratégique, notamment pour les commerces créditant les points selon le montant dépensé, mais elle ne doit pas retarder les premiers clients.

---

# 33. Go / No-Go avant prospection

La prospection commerciale active peut commencer lorsque les points suivants sont validés :

```text
[ ] retiko.fr opérationnel
[ ] création de compte fonctionnelle
[ ] connexion / déconnexion fonctionnelles
[ ] /api/health vert
[ ] base Neon production reliée
[ ] programme fidélité configurable
[ ] QR commerce fonctionnel
[ ] inscription client fonctionnelle
[ ] carte client fonctionnelle
[ ] scanner fonctionnel
[ ] code court fonctionnel
[ ] crédit fonctionnel
[ ] récompense fonctionnelle
[ ] récupération email fonctionnelle
[ ] test iPhone réel effectué
[ ] test Android réel effectué
[ ] isolation tenant validée
[ ] procédure incident prête
[ ] politique de confidentialité prête
[ ] accord pilote prêt
[ ] prix public fixé
[ ] offre annuelle configurée
[ ] démonstration prête
[ ] support commercial prêt
[ ] liste de 50 prospects prête
```

Stripe n’a pas besoin d’être activé avant le tout premier pilote gratuit, mais doit être prêt avant la première conversion payante.

---

# 34. Ordre d’exécution jusqu’au lancement commercial

| Ordre | Chantier |
|---:|---|
| **1** | Production Vercel + Neon + secrets |
| **2** | `/api/health` entièrement vert |
| **3** | Parcours signup/login réel |
| **4** | Parcours client complet en production |
| **5** | Validation isolation tenant / migration sécurité |
| **6** | Resend + récupération sécurisée |
| **7** | PWA iPhone réelle |
| **8** | PWA Android réelle |
| **9** | Test scanner conditions de caisse |
| **10** | Onboarding par type de commerce |
| **11** | QR/A4 commercial définitif |
| **12** | RGPD + accord pilote |
| **13** | Démo commerciale < 5 min |
| **14** | Landing page orientée commerces de proximité |
| **15** | Tarification Flex 24,99 €, Retiko 12 19,99 € et annuelle 210 € présentée |
| **16** | Liste initiale de 50 prospects |
| **17** | Répétition commerciale |
| **18** | Prospection physique Corrèze |
| **19** | Premier pilote |
| **20** | Corrections terrain |
| **21** | Pilotes 2 et 3 |
| **22** | Stripe avant première conversion payante |
| **23** | Conversion annuelle prioritaire |
| **24** | Extension de la prospection au Puy-de-Dôme |
| **25** | Wallet et roadmap V1 selon les données |

---

# 35. Principe directeur

Retiko n’est plus développé pour accumuler des fonctionnalités.

La priorité est désormais :

```text
produit stable
→ premier commerce réel
→ usage mesuré
→ conversion payante
→ rétention
→ répétition de la vente
```

Le produit doit pouvoir être vendu à plusieurs métiers sans devenir un logiciel différent pour chacun.

Le premier avantage commercial recherché est la simplicité : remplacer une carte papier ou l’absence totale de programme fidélité par une expérience digitale immédiatement compréhensible.

La première preuve de marché n’est pas le nombre de fonctionnalités livrées. C’est le nombre de commerces qui utilisent réellement Retiko après la période gratuite et acceptent de payer, avec une préférence donnée à l’abonnement annuel.

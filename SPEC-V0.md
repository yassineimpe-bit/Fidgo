# Retiko V0
## Cahier des charges pré-pilote consolidé

### 1. Objectif de la V0

Retiko doit permettre à un commerce indépendant de lancer un programme de fidélité numérique utilisable par de vrais clients, sans application native obligatoire.

La V0 est validée lorsque :

> **Un restaurateur qui ne connaît pas Retiko peut créer son compte, configurer son programme, imprimer son QR, installer Retiko sur son téléphone, inscrire un vrai client, scanner sa carte, créditer un passage, atteindre puis consommer une récompense sans aide nécessaire du produit.**

Pendant le pilote, Retiko sera néanmoins présent au premier service. L’autonomie est un critère de qualité du produit, pas une obligation d’abandonner le commerçant avec une bêta un samedi midi.

---

# 2. Boucle produit de référence

La boucle à rendre parfaite avant toute autre fonctionnalité est :

```text
Restaurateur
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
Restaurateur scanne le QR client
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

# 3. P0 : infrastructure de production

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
| domaine définitif | configuré |

Le healthcheck attendu doit indiquer au minimum :

```json
{
  "ok": true,
  "database": "up",
  "auth": "up"
}
```

Apple et Google peuvent encore être désactivés.

---

# 4. P0 : domaine définitif

Le domaine doit être choisi et configuré **avant toute impression physique et avant le premier pilote**.

Il ne faut pas distribuer :

```text
fidgo-env-probe.vercel.app
```

aux clients.

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

Le QR imprimé doit donc pointer directement vers quelque chose du type :

```text
https://<domaine-final>/j/mon-commerce
```

Le domaine doit être stabilisé avant :

- impression des affiches ;
- activation de Resend ;
- configuration de `EMAIL_FROM` ;
- émission réelle des passes Apple Wallet.

Une redirection depuis l’ancien domaine Vercel pourra rester en sécurité, mais aucun support commercial ne doit dépendre de ce domaine de test.

---

# 5. P0 : validation sur appareils physiques

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

Le besoin de reconnexion après installation est acceptable à condition d’être correctement expliqué.

La PWA scanner doit fonctionner avant de construire l’onboarding autour d’elle.

---

# 6. P0 : scanner rush-safe

Le scanner doit fonctionner en situation réelle de service, pas seulement posé tranquillement sur un bureau avec un QR parfait imprimé sur une feuille A4 neuve.

## Scan QR

Le QR client contient l’identifiant Retiko prévu par le système.

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
| p95 parcours | < 2 s |

---

## Fallback manuel

La saisie du **code court** est obligatoire.

Exemple :

```text
Code client

[ 482913 ] [ Rechercher ]
```

Elle doit permettre de retrouver la carte même si :

- caméra indisponible ;
- QR client illisible ;
- écran endommagé ;
- luminosité mauvaise.

L’email peut rester un mode secondaire réservé au staff autorisé.

---

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

Succès : vibration courte + bip.

Récompense : pattern distinct.

Erreur : retour distinct et immédiatement compréhensible.

---

# 7. P0 : anti double-crédit

La protection repose sur plusieurs niveaux :

```text
idempotency_key
+
cooldown
+
interface
+
audit
```

### Cooldown par défaut

Décision V0 :

```text
2 minutes
```

Le but est d’éviter le double scan accidentel, pas d’empêcher un client de revenir plusieurs fois dans la journée.

Si un second crédit est demandé :

```text
Passage déjà enregistré
il y a 42 secondes.
```

Aucune nouvelle unité n’est ajoutée automatiquement.

### Override

Un `OWNER` ou `MANAGER` peut utiliser :

```text
Créditer quand même
```

avec :

```text
motif obligatoire
```

et audit :

```text
CARD_ADJUSTED
```

---

# 8. P0 : ajustement manuel et procédure de rattrapage

Le dashboard doit permettre :

```text
recherche par code court
→ ouverture client
→ ajuster solde
→ saisir motif
→ confirmer
```

Une modification manuelle doit toujours produire un audit log :

```text
CARD_ADJUSTED
```

avec au minimum :

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

# 9. P0 : carte web client

La carte `/c/{token}` constitue la référence V0.

Elle doit afficher :

| Information | Obligatoire |
|---|---|
| commerce | ✅ |
| logo | ✅ |
| couleur | ✅ |
| prénom | ✅ |
| QR | ✅ |
| code court | ✅ |
| solde | ✅ |
| seuil | ✅ |
| progression | ✅ |
| récompense | ✅ |
| récompense disponible | ✅ |

Exemple :

```text
CAFÉ MARTIN

Yassine

● ● ● ● ● ● ● ○ ○ ○

7 / 10 tampons

Encore 3 passages
avant votre café offert

[ QR ]

482913
```

---

# 10. P0 : rafraîchissement automatique du solde

Lorsque la carte reste affichée au comptoir, le client doit voir son nouveau tampon apparaître sans rafraîchir manuellement la page.

Il faut utiliser un endpoint de lecture dédié et léger.

Exemple :

```text
/api/card/{token}/status
```

Cet endpoint ne renvoie que les informations nécessaires :

```json
{
  "balance": 8,
  "threshold": 10,
  "rewardAvailable": false,
  "updatedAt": "..."
}
```

Il dispose de son **propre rate limiter**, calibré pour le polling.

### Politique polling V0

```text
carte visible
→ polling toutes les 3 secondes
```

Lorsque `document.visibilityState !== "visible"` :

```text
polling suspendu
```

Après environ :

```text
5 minutes sans interaction
```

le polling s’arrête.

L’interface affiche alors :

```text
[ Actualiser mon solde ]
```

Une interaction avec la page peut relancer la période active.

Cela évite qu’un téléphone oublié dans une poche transforme Retiko en test de charge involontaire.

---

# 11. P0 : récupération de carte

La récupération par stockage local est uniquement un confort.

Elle ne constitue **pas** une stratégie fiable de récupération long terme, notamment à cause des comportements de stockage navigateur/PWA sur mobile.

## Même navigateur

Si Retiko reconnaît localement une carte du commerce :

```text
Vous avez déjà une carte Retiko

[ Ouvrir ma carte ]
```

Très utile pour un retour rapide.

Mais aucune mesure de rétention ne doit dépendre de ce mécanisme.

---

## Récupération email

Elle devient **P0 obligatoire avant le pilote**.

Prérequis :

```text
domaine définitif
→ configuration email
→ Resend
→ EMAIL_FROM
→ CARD_RECOVERY_ENABLED=true
```

Le mécanisme développé reste :

```text
token aléatoire 256 bits
→ hash stocké en DB
→ expiration 15 minutes
→ usage unique
→ envoyé uniquement à l'adresse concernée
```

---

# 12. Anti-énumération récupération

Une requête de récupération ne doit jamais révéler si une adresse possède une carte.

Réponse publique unique :

> Si cette adresse est associée à une carte, vous allez recevoir un lien pour la retrouver.

Même :

```text
status HTTP
structure de réponse
message
comportement observable
```

qu’une carte existe ou non.

L’email n’est réellement envoyé que si une carte correspond.

Le traitement serveur doit limiter autant que raisonnablement possible les différences temporelles observables.

---

# 13. P1 mais avant pilote : onboarding commerçant

Objectif :

```text
< 5 minutes
```

entre la création du compte et un premier QR fonctionnel.

Parcours :

| Étape | Action |
|---:|---|
| 1 | compte |
| 2 | commerce |
| 3 | logo/couleur |
| 4 | tampons ou points |
| 5 | seuil |
| 6 | récompense |
| 7 | QR |
| 8 | installation PWA |
| 9 | premier scan test |

Afficher une checklist :

```text
Configuration Retiko

✓ Compte créé
✓ Commerce configuré
✓ Programme fidélité
○ Imprimer mon QR
○ Installer Retiko
○ Faire un test
```

---

# 14. QR et affiche pilote

L’affiche A4 est obligatoire avant le pilote.

Elle comporte :

```text
logo commerce
nom
promesse fidélité
récompense
QR
éventuellement URL courte
```

Exemple :

```text
VOTRE FIDÉLITÉ
SUR VOTRE TÉLÉPHONE

10 passages = 1 café offert

[ QR ]

Scannez pour obtenir votre carte
```

Le QR pointe exclusivement vers le domaine définitif.

Les formats A5, sticker, chevalet ou réseaux sociaux pourront être ajoutés plus tard.

---

# 15. P0 : instrumentation du pilote

Les analytics avancées restent hors V0.

L’instrumentation, elle, est obligatoire.

Événements minimum :

```text
JOIN_PAGE_VIEW
JOIN_SUBMIT

SCAN_SUCCESS
SCAN_FAILED

CREDIT_SUCCESS
REWARD_REDEEMED
```

`SCAN_SUCCESS` doit notamment enregistrer :

```text
durationMs
```

sans token brut, email ou secret.

Les transactions existantes restent la source de vérité pour :

```text
passages
dates
cartes
récompenses
fréquence
```

---

# 16. KPI pilote

## Conversion

```text
JOIN_SUBMIT
/
JOIN_PAGE_VIEW
```

## Performance scanner

Mesurer :

```text
p50
p95
taux d'erreur
```

## Retour client

Exemple de métrique :

```text
cartes ayant des transactions
sur au moins deux jours distincts
/
cartes ayant au moins une transaction
```

## Récompenses

```text
nombre de REWARD_REDEEMED
```

## Adoption par le personnel

`scans/jour` seul n’est pas interprétable.

Il faut récupérer auprès du commerce :

```text
nombre de tickets caisse / jour
```

issu de son Z de caisse ou équivalent.

Le relevé peut être transmis une fois par semaine.

Le KPI devient :

```text
scans fidélité
/
tickets caisse
```

On peut ainsi distinguer :

```text
12 scans / 40 tickets = intéressant
12 scans / 300 tickets = personnel n'utilise presque pas Retiko
```

Cette collecte doit être prévue dans l’accord pilote.

---

# 17. Disponibilité opérationnelle

Chaque commerce pilote doit définir ses **plages de service critiques**.

Exemple :

```text
Lundi–vendredi :
11h30–14h00
18h30–21h30

Samedi :
11h30–22h00
```

Les métriques d’incident distinguent :

```text
indisponibilité totale
```

et :

```text
indisponibilité pendant les plages critiques
```

Un incident à 03h00 n’a évidemment pas le même poids qu’une panne à 12h45.

KPI :

```text
Disponibilité pendant services
=
temps opérationnel pendant plages critiques
/
temps total des plages critiques
```

---

# 18. Observabilité

Avant le premier pilote, Retiko doit disposer d’un outil de remontée d’erreurs type Sentry ou équivalent.

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

Pas :

```text
password
JWT
token carte
clé privée
email complet inutile
```

`/api/health` doit également être surveillé.

---

# 19. Procédure d’incident pilote

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

avec audit `CARD_ADJUSTED`.

Pour les premiers pilotes, objectif interne :

```text
incident bloquant pendant service
→ prise en compte < 30 minutes
```

Ce n’est pas un SLA commercial.

---

# 20. RGPD pré-pilote

Pour les données du programme fidélité :

```text
Commerce = responsable du traitement

Retiko = sous-traitant
```

Retiko peut rester responsable de traitement pour ses propres données SaaS :

```text
compte restaurateur
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

Le consentement marketing doit être séparé du fonctionnement de la carte.

---

# 21. Accord pilote

Durée proposée :

```text
30 jours
```

Prix :

```text
gratuit
```

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
relevé hebdomadaire du nombre de tickets caisse
plages horaires critiques
```

---

# 22. Sous-traitance RGPD

Annexe minimum :

```text
nature du traitement
finalité
durée
catégories de données
catégories de personnes
mesures de sécurité
sous-traitants ultérieurs
gestion incidents
droits des personnes
restitution/suppression
```

Fournisseurs listés uniquement s’ils sont réellement utilisés :

```text
Vercel
Neon
Resend
Sentry / équivalent
```

---

# 23. Pilotes terrain

Nombre initial :

```text
1 à 3 commerces
```

Cibles privilégiées :

```text
coffee shop
bubble tea
snack
boulangerie indépendante
petit restaurant
```

Conditions intéressantes :

```text
trafic régulier
clientèle récurrente
décideur présent
peu de hiérarchie
```

Le premier service est observé directement.

Ensuite Retiko doit pouvoir fonctionner sans intervention quotidienne.

---

# 24. Wallet

Le compte Apple Developer peut être lancé immédiatement car le délai administratif est indépendant du développement.

Mais pour la V0 :

```text
carte web = produit fonctionnel
PWA = accès rapide
Wallet = confort et rétention
```

Apple/Google peuvent être activés pendant le pilote.

Aucune conclusion quantitative forte ne doit être tirée d’une comparaison séquentielle semaine 1 / semaine 2 sur trois commerces.

Pendant le pilote on mesure seulement :

```text
nombre d'ajouts Wallet
problèmes observés
usage réel
feedback clients
feedback commerce
```

---

# 25. Ce qui est explicitement hors V0

Pour empêcher Retiko de se transformer de nouveau en ERP de fidélité avant d’avoir trois utilisateurs :

| Fonctionnalité | Moment |
|---|---|
| analytics avancées | après pilote |
| campagnes marketing | après pilote |
| segmentation clients | après pilote |
| Stripe | après validation |
| pricing définitif | après retours |
| multi-établissements | après demande |
| admin avancé | après pilote |
| permissions extrêmement granulaires | après pilote |
| MFA | V1 |
| PIN caisse | selon retour |
| API publique | plus tard |
| BI avancée | avec vraies données |

---

# 26. Ordre d’exécution définitif

| Ordre | Chantier |
|---:|---|
| **1** | Domaine définitif |
| **2** | Production Vercel + Neon + secrets |
| **3** | `/api/health` vert |
| **4** | PWA iOS/Android testée |
| **5** | Carte web complète |
| **6** | Auto-refresh contrôlé |
| **7** | Scanner rush-safe |
| **8** | Code court manuel |
| **9** | Cooldown + override audité |
| **10** | Ajustement manuel audité |
| **11** | Resend + récupération sécurisée |
| **12** | Instrumentation pilote |
| **13** | Monitoring erreurs |
| **14** | Onboarding < 5 min |
| **15** | QR/A4 définitif |
| **16** | RGPD + accord pilote |
| **17** | Playwright boucle principale |
| **18** | Playwright isolation tenant |
| **19** | Premier commerce pilote |
| **20** | Corrections terrain |
| **21** | Commerces pilotes 2 et 3 |
| **22** | Wallet réel |
| **23** | roadmap V1 décidée avec les données |

La différence essentielle avec le tout premier cahier des charges est maintenant nette : **on ne construit plus Retiko pour compléter une liste de fonctionnalités. On construit exactement ce qu’il faut pour survivre une semaine derrière une vraie caisse et apprendre quelque chose de fiable.**

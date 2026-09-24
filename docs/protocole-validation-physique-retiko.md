# Protocole de Validation Physique - Retiko (Pré-Pilote)

**Objectif :** Valider les conditions réelles d'utilisation (Gate Pilote §23) et fermer les sections §6, §7, §10, §11 en s'assurant que l'application est prête pour un usage intensif en commerce.  
**Ressources :** 1 testeur, 2 smartphones (1 iPhone récent, 1 Android récent).

## 1. Préparation & Matériel

### Matériel requis

- **Appareil A (iPhone) :** iPhone récent (iOS à jour), navigateur Safari principal.
- **Appareil B (Android) :** Smartphone Android récent, navigateur Chrome principal.
- **Règle de test :** Un appareil ne pouvant scanner son propre écran, l'iPhone scanne toujours l'Android, et l'Android scanne toujours l'iPhone.
- **Réseau :** Connexion 4G/5G standard. Prévoir un moyen de brider ou couper temporairement la connexion pour les tests adverses.

### Configuration Wallets (Production)

**Apple Wallet (§10)**

- [ ] Certificats Apple Wallet de production générés et valides.
- [ ] Serveur configuré pour signer les pass avec les certificats de production.

**Google Wallet (§11)**

- [ ] Compte Google Wallet / Issuer de production approuvé.
- [ ] Service Account configuré côté backend.
- [ ] Credentials de production chargés côté serveur uniquement.

## 2. Parcours Initial : Création de Zéro

*À réaliser avant de démarrer les scans physiques.*

- [ ] Inscription (Signup) d'un nouveau commerce.
- [ ] Vérification de l'e-mail.
- [ ] Onboarding complété.
- [ ] Configuration d'un programme de fidélité basique.
- [ ] Création d'un premier compte Employé.
- [ ] Génération et affichage du QR Code d'inscription du commerce.
- [ ] Scan du QR d'inscription par le client.
- [ ] Inscription client réussie.
- [ ] PWA installée sur iPhone via Safari.
- [ ] PWA installée sur Android via Chrome.
- [ ] Apple Wallet installé et pass Retiko ajouté sur iPhone.
- [ ] Google Wallet installé et objet Retiko ajouté sur Android.

---

## 3. Matrice des 30 Scans Physiques Nominaux

**Objectif :** Réaliser 30 vrais scans physiques réussis en conditions normales de caisse.  
Ces 30 mesures servent au calcul des performances et à la validation de la case §23 « 30 scans physiques réels ».

Répartition :

- **15 scans avec iPhone comme scanner** et Android comme client.
- **15 scans avec Android comme scanner** et iPhone comme client.
- Les supports client alternent entre PWA et Wallet compatible.

| N° | Scanner | Client (Support) | Scénario nominal | Temps Total (ms)* | Résultat (OK/KO) | Notes |
|---|---|---|---|---:|---|---|
| 1 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 2 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 3 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 4 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 5 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 6 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 7 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 8 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 9 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 10 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 11 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 12 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 13 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 14 | iPhone | Android (Google Wallet) | Scan standard | | | |
| 15 | iPhone | Android (PWA Chrome) | Scan standard | | | |
| 16 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 17 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 18 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 19 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 20 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 21 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 22 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 23 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 24 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 25 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 26 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 27 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 28 | Android | iPhone (PWA Safari) | Scan standard | | | |
| 29 | Android | iPhone (Apple Wallet) | Scan standard | | | |
| 30 | Android | iPhone (PWA Safari) | Scan standard | | | |

*\* Temps Total = Détection QR → confirmation serveur affichée.*

### Validation des 30 scans nominaux

- [ ] 30/30 scans physiques réellement exécutés.
- [ ] 30/30 scans réussis.
- [ ] Aucun double crédit.
- [ ] Aucun scan silencieusement perdu.
- [ ] Aucun écart de solde observé entre les supports.

---

## 4. Scénarios Adverses et Edge Cases

**Objectif :** Tester la robustesse fonctionnelle en plus des 30 scans nominaux.  
Ces scénarios ne sont **pas inclus** dans les calculs médiane / p90 / p95.

Les erreurs attendues ne sont pas considérées comme des échecs si Retiko réagit conformément au comportement attendu.

| ID | Scanner | Client (Support) | Scénario adverse | Résultat attendu | Résultat (OK/KO) | Notes |
|---|---|---|---|---|---|---|
| A1 | iPhone | Android (PWA Chrome) | **Réseau lent** sur le scanner | Succès ou attente contrôlée, aucun crash, aucun double crédit | | |
| A2 | Android | iPhone (PWA Safari) | **Perte réseau temporaire pendant requête** | Erreur claire, reprise possible, aucun double crédit | | |
| A3 | Android | iPhone (Apple Wallet) | **Double lecture rapide** du même QR | Un seul crédit effectif | | |
| A4 | iPhone | Android (Google Wallet) | **Double lecture rapide** du même QR | Un seul crédit effectif | | |
| A5 | iPhone | QR externe sur écran PC | **QR invalide** | Message clair « QR non reconnu », aucune transaction | | |
| A6 | Android | iPhone (PWA Safari) | **Carte inactive / suspendue** | Refus propre, aucune transaction | | |
| A7 | Android | iPhone (Apple Wallet) | **Première consommation récompense** | Succès, récompense consommée, ledger cohérent | | |
| A8 | Android | iPhone (Apple Wallet) | **Deuxième tentative sur la même récompense** | Refus, aucun double débit, ledger inchangé | | |
| A9 | iPhone | Android (Google Wallet) | **Première consommation récompense** | Succès, récompense consommée, ledger cohérent | | |
| A10 | iPhone | Android (Google Wallet) | **Deuxième tentative sur la même récompense** | Refus, aucun double débit, ledger inchangé | | |
| A11 | iPhone | Android (PWA Chrome) | **Manager : override manuel** | Succès, solde ajusté correctement, historique correct | | |
| A12 | Android | iPhone (PWA Safari) | **Manager : override manuel** | Succès, solde ajusté correctement, historique correct | | |

### Validation des scénarios adverses

- [ ] Aucune erreur provoquée ne crée de transaction fantôme.
- [ ] Aucune perte réseau ne crée de double crédit lors de la reprise.
- [ ] Les QR invalides sont refusés proprement.
- [ ] Une récompense déjà consommée ne peut pas être rejouée.
- [ ] Les actions manager sont correctement attribuées dans l'historique.

---

## 5. Mesures de Performances & p95

Les calculs sont réalisés **uniquement sur les 30 scans nominaux réussis**.

### Méthode statistique

Utiliser la méthode **Nearest-rank** :

1. Trier les 30 temps du plus rapide au plus lent.
2. Calculer le rang :

`R = ceil(percentile × N)`

Avec `N = 30` :

- **Médiane (p50) :** rang `ceil(0,50 × 30) = 15`
- **p90 :** rang `ceil(0,90 × 30) = 27`
- **p95 :** rang `ceil(0,95 × 30) = 29`
- **Maximum :** rang 30

### Résultats

- **Médiane :** ______ ms
- **p90 :** ______ ms
- **p95 :** ______ ms
- **Maximum :** ______ ms

### Seuils de référence

- **Seuil pilote officiel GO / NO-GO : p95 ≤ 2 000 ms**
- **Cible interne d'optimisation : p95 ≤ 1 500 ms**

---

## 6. Contrôle de Cohérence Final (Data Integrity)

À la fin des 30 scans nominaux et des scénarios adverses, vérifier sur les deux appareils et côté données :

- [ ] Le solde PWA correspond exactement au solde réel / ledger.
- [ ] Le solde Apple Wallet correspond au solde PWA iPhone après synchronisation.
- [ ] Le solde Google Wallet correspond au solde PWA Android après synchronisation.
- [ ] Aucun scan réussi n'est absent de l'historique.
- [ ] Aucune transaction n'est perdue après refresh PWA.
- [ ] Aucun double crédit silencieux après les tests A3 / A4.
- [ ] Les récompenses consommées en A7 / A9 ne sont pas rejouables en A8 / A10.
- [ ] Les actions manager sont correctement attribuées au staff dans l'historique.
- [ ] La session commerçant reste valide après une longue série de scans.
- [ ] Aucun décalage inexpliqué entre PWA, Wallet et ledger.

**Toute divergence inexpliquée entraîne un NO-GO.**

---

## 7. Checklists de Validation Spécifiques

### Checklist PWA (§6)

**Safari iOS**

- [ ] Installation PWA via écran d'accueil fonctionnelle.
- [ ] Navigation fluide en mode PWA.
- [ ] Affichage QR correct.
- [ ] Aucun débordement ou élément inaccessible.
- [ ] Refresh / réouverture conserve un état cohérent.

**Chrome Android**

- [ ] Installation PWA / écran d'accueil fonctionnelle.
- [ ] Navigation fluide.
- [ ] Affichage QR correct.
- [ ] Aucun débordement ou élément inaccessible.
- [ ] Refresh / réouverture conserve un état cohérent.

### Checklist UX Rush Commerçant (§7)

- [ ] Ouverture caméra rapide, sans délai bloquant.
- [ ] Pas besoin de viser précisément.
- [ ] QR détectable avec luminosité client réduite.
- [ ] Fonctionnement correct sous lumière moyenne / faible.
- [ ] Utilisable à une main.
- [ ] Boutons suffisamment grands.
- [ ] Feedback succès / erreur visible immédiatement.
- [ ] Temps de retour prêt au scan suivant quasi immédiat.
- [ ] Aucune action secondaire nécessaire entre deux clients.
- [ ] Aucun scroll inutile pendant le flux de scan.
- [ ] Aucun clavier virtuel intempestif.
- [ ] Verrou anti-double action pendant l'appel réseau.
- [ ] Une erreur réseau permet une reprise claire sans double crédit.

### Checklist Apple Wallet (§10)

*Sur iPhone uniquement.*

- [ ] Certificat production valide.
- [ ] Création et téléchargement du pass réussis.
- [ ] Installation réelle dans Apple Wallet.
- [ ] Design / logo / données corrects.
- [ ] QR lisible par le scanner Android.
- [ ] Mise à jour après crédit.
- [ ] Délai observé de mise à jour : ______ s.
- [ ] Mise à jour après consommation de récompense.
- [ ] Données cohérentes avec PWA et ledger après synchronisation.

### Checklist Google Wallet (§11)

*Sur Android uniquement.*

- [ ] Issuer production actif.
- [ ] Service Account configuré côté backend.
- [ ] Création de l'objet réelle.
- [ ] Installation réelle dans Google Wallet.
- [ ] Design / logo / données corrects.
- [ ] QR lisible par le scanner iPhone.
- [ ] Mise à jour après crédit.
- [ ] Délai observé de mise à jour : ______ s.
- [ ] Mise à jour après consommation de récompense.
- [ ] Données cohérentes avec PWA et ledger après synchronisation.

---

## 8. Suivi des Bugs

| Gravité | Description | Étapes pour reproduire | Appareil / Support | Statut |
|---|---|---|---|---|
| P0 / P1 / P2 / P3 | | | | |

### Classification

- **P0 :** perte de données, double crédit, faille critique, système inutilisable.
- **P1 :** bug majeur bloquant le pilote ou le flux de caisse.
- **P2 :** gêne réelle avec contournement possible.
- **P3 :** cosmétique / amélioration non bloquante.

---

## 9. Conditions GO / NO-GO Pilote

La Gate Pilote (§23) est **GO** uniquement si toutes les conditions suivantes sont remplies :

- [ ] Signup → vérification e-mail → onboarding complet fonctionnent sur le commerce de test.
- [ ] Les **30 scans physiques nominaux** ont tous été réellement exécutés.
- [ ] **30/30 scans nominaux réussis.**
- [ ] **p95 nominal ≤ 2 000 ms.**
- [ ] Aucun double crédit silencieux.
- [ ] Aucun scan nominal perdu.
- [ ] Aucun écart inexpliqué entre PWA, Wallets et ledger.
- [ ] Apple Wallet validé sur un vrai iPhone.
- [ ] Google Wallet validé sur un vrai Android.
- [ ] Safari iOS validé.
- [ ] Chrome Android validé.
- [ ] Les scénarios adverses A1 à A12 ont tous été exécutés.
- [ ] Les comportements d'erreur correspondent aux résultats attendus.
- [ ] Zéro bug P0.
- [ ] Zéro bug P1.
- [ ] UX rush commerçant jugée utilisable.
- [ ] Scanner utilisable sans manipulation secondaire entre deux clients.

### Décision finale

- **GO pilote :** [ ]
- **NO-GO pilote :** [ ]

**Date :** ____________________  
**Testeur :** ____________________  
**Version / commit Retiko testé :** ____________________  
**iPhone / version iOS :** ____________________  
**Android / version Android :** ____________________  
**Réseau principal utilisé :** ____________________

---

## 10. Résumé de Validation

| Domaine | Statut |
|---|---|
| PWA Safari iOS | ⬜ |
| PWA Chrome Android | ⬜ |
| Scanner iPhone | ⬜ |
| Scanner Android | ⬜ |
| Apple Wallet | ⬜ |
| Google Wallet | ⬜ |
| 30 scans physiques | ⬜ |
| p95 ≤ 2 000 ms | ⬜ |
| Anti-double crédit | ⬜ |
| Intégrité ledger | ⬜ |
| UX Rush | ⬜ |
| Gate Pilote §23 | ⬜ |

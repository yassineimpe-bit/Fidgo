# Protocole UX terrain — Retiko V1 pilote

> **Version terrain courte :** [`docs/kit-pilote-ux-retiko.md`](./kit-pilote-ux-retiko.md) contient les 7 fiches imprimables à utiliser pendant la visite. Le présent document reste la référence détaillée.

## Objectif

Ce protocole complète `docs/protocole-validation-physique-retiko.md`.

Le protocole physique répond principalement à :

> Est-ce que Retiko fonctionne correctement sur de vrais appareils, avec des mesures vérifiables ?

Ce protocole UX répond à :

> Est-ce qu'un vrai commerçant comprend Retiko, l'utilise avec confiance et reste autonome en situation réelle ?

Les deux preuves sont complémentaires. Aucune observation UX ne remplace les 30 scans physiques, les tests iPhone/Android, le p95 ou l'audit du ledger.

---

## 1. Principes d'observation

Le testeur :

1. donne une consigne métier ;
2. laisse le participant essayer ;
3. observe les hésitations, retours arrière et erreurs ;
4. n'explique pas l'interface avant la tâche ;
5. intervient seulement en cas de blocage réel, demande explicite d'aide ou risque de mauvaise opération ;
6. note toute intervention comme une friction.

Ne pas utiliser un délai fixe comme règle automatique d'intervention. Le temps d'hésitation est une donnée d'observation, pas à lui seul un verdict.

### Script d'introduction

> Aujourd'hui, c'est Retiko qui est testé, pas toi. Je vais te donner des situations réelles et te laisser faire. Je vais peu intervenir pour voir ce qui est clair ou non. Si quelque chose bloque, ça nous aide à améliorer le produit.

Éviter les formulations qui indiquent où cliquer ou qui suggèrent la réponse.

Exemples à éviter :

- « Ouvre le menu en haut à droite. »
- « Tu as vu le bouton en bas ? »
- « Tu trouves cet écran facile ? »
- « On a conçu ça pour aller vite, ça marche bien non ? »

---

## 2. Préparation

Avant la session :

- environnement approuvé pour le pilote opérationnel ;
- `/api/health` vert ;
- migrations nécessaires appliquées dans l'environnement testé ;
- compte e-mail accessible pour la vérification ;
- smartphone client connecté ;
- smartphone commerçant connecté ;
- protocole physique disponible séparément ;
- carnet ou grille d'observation prête ;
- aucune donnée client réelle utilisée sans nécessité et consentement approprié.

Pour un test du parcours depuis zéro, ne pas préconfigurer le compte commerçant.

---

# Session 1 — Première prise en main

## 3. Création du compte et onboarding

Consigne :

> Crée ton compte Retiko et prépare ton programme de fidélité comme si tu voulais l'utiliser aujourd'hui.

Observer :

- découverte du signup ;
- compréhension de la vérification e-mail ;
- reprise après vérification ;
- compréhension de la progression onboarding ;
- distinction champs obligatoires / facultatifs ;
- distinction Commerce / Programme ;
- retours arrière ;
- mots non compris ;
- demande d'aide.

Ne pas guider vers une route ou un bouton précis.

---

## 4. Identité du commerce

Consigne :

> Personnalise Retiko pour qu'un client reconnaisse ton commerce.

Observer :

- nom ;
- logo ;
- couleurs ;
- fond de carte ;
- image ;
- coordonnées ;
- usage de l'aperçu ;
- compréhension de ce qui sera visible par le client ;
- hésitation entre upload et URL de logo.

---

## 5. Programme de fidélité

Consigne :

> Configure ton programme comme ton vrai programme de fidélité.

Observer :

- Tampons vs Points ;
- seuil ;
- récompense ;
- règle de points ;
- unité personnalisée ;
- cooldown ;
- limite journalière ;
- expiration ;
- notification de récompense ;
- message carte.

Après configuration, demander :

> Explique-moi avec tes propres mots ce qui va se passer quand un client achète chez toi.

Comparer la compréhension exprimée avec la configuration réelle.

Une configuration techniquement correcte mais mal comprise reste une friction UX.

---

## 6. QR d'inscription

Consigne :

> Fais maintenant en sorte qu'un client puisse obtenir sa carte.

Observer :

- découverte de l'Affiche QR ;
- compréhension du QR d'inscription ;
- confusion éventuelle avec le QR propre à une carte client ;
- retours arrière ;
- besoin d'aide.

---

## 7. Inscription client

Un testeur ou participant joue le client et scanne le QR.

Observer :

- identification du commerce ;
- compréhension de la récompense ;
- champs compris sans explication ;
- hésitation sur l'e-mail, le téléphone ou le prénom ;
- compréhension du consentement marketing ;
- compréhension de la création de la carte.

Après création, demander :

> Sans que je t'explique, dis-moi ce que cette carte te montre.

Le client devrait pouvoir identifier :

- commerce ;
- solde ;
- progression ;
- récompense ;
- QR.

Wallet n'est pas une dépendance du premier pilote.

---

## 8. Premier crédit

Consigne commerçant :

> Ce client vient d'acheter. Ajoute sa fidélité.

Observer :

- découverte du Scanner ;
- présentation du QR ;
- compréhension de la fiche client ;
- choix du bon bouton ;
- compréhension du feedback ;
- perception claire du moment où l'action est terminée ;
- passage au client suivant.

---

# Session 2 — Service réel / Rush

## 9. Observation en situation réelle

Le testeur se met en retrait.

Par tranche d'observation, relever :

| Donnée | Valeur |
|---|---:|
| Clients observés | |
| Scans réussis | |
| Recherches manuelles | |
| Récompenses consommées | |
| Hésitations visibles | |
| Mauvais boutons | |
| Interventions externes | |
| Incidents réseau/caméra | |

Ajouter un commentaire uniquement lorsqu'un événement apporte du contexte.

---

## 10. Événements UX à noter

Noter notamment :

- premier regard au mauvais endroit ;
- clic sur la mauvaise action ;
- retour arrière ;
- scroll inattendu ;
- double clic ;
- mot non compris ;
- attente sans savoir si Retiko travaille ;
- succès interprété comme erreur ;
- erreur interprétée comme succès ;
- rescan inutile ;
- question « c'est passé ? » ;
- besoin de demander quoi faire ensuite.

---

## 11. Scanner Rush

Après stabilisation de #170, observer une petite séquence de clients consécutifs.

Faire varier raisonnablement :

- QR immédiatement disponible ;
- QR mal cadré ;
- luminosité moyenne ;
- client lent à présenter sa carte ;
- recherche manuelle ;
- interruption brève ;
- réseau plus lent.

Observer :

- erreurs de bouton ;
- temps perdu à comprendre l'état ;
- compréhension des feedbacks ;
- capacité à reprendre après interruption ;
- risque de double action ;
- continuité du service.

Les mesures officielles de performance restent dans le protocole physique.

---

## 12. Récompense

Après livraison de #172, préparer une carte avec récompense disponible.

Consigne :

> Ce client veut utiliser sa récompense.

Observer :

- découverte de l'action ;
- compréhension du coût ;
- compréhension du solde avant/après ;
- lecture de la confirmation ;
- confiance au moment de confirmer ;
- compréhension du succès ;
- retour au prochain client.

Une seconde récompense nécessite un nouveau scan conformément au flux retenu.

---

## 13. Réseau incertain

Tester séparément du flux nominal :

- réseau coupé avant l'action ;
- réseau perdu pendant une action ;
- reprise.

Observer :

- l'utilisateur sait-il si l'action est confirmée ?
- attend-il ou reclique-t-il ?
- comprend-il le retry ?
- rescanne-t-il inutilement ?

Un état ambigu sur une action de fidélité est un signal UX important.

---

## 14. Caméra indisponible

Refuser la permission caméra ou rendre la caméra indisponible.

Observer :

- compréhension du problème ;
- découverte du retry ;
- découverte de la recherche manuelle ;
- possibilité de continuer le service.

Le critère est la continuité métier, pas uniquement la qualité du message.

---

## 15. Employé

Avec un compte EMPLOYEE :

> Tu commences ton service. Utilise Retiko pour les clients.

Observer :

- accès au Scanner ;
- compréhension du cooldown ;
- compréhension du besoin d'un responsable pour un override ;
- redeem ;
- recherche manuelle ;
- déconnexion ;
- absence de confusion avec les fonctions back-office.

Objectif :

> Un employé doit pouvoir assurer le service sans devoir comprendre tout Retiko.

---

## 16. Manager

Tester seulement les actions réellement autorisées.

Observer notamment :

- scanner ;
- override « Nouvel achat » ;
- actions clients ;
- équipe selon permissions ;
- programme selon permissions.

Ne pas inventer de nouveaux droits pendant le test.

---

# Session 3 — Retour après plusieurs jours

## 17. Entretien court

Questions ouvertes :

1. Qu'as-tu utilisé le plus ?
2. Qu'est-ce que tu n'as jamais utilisé ?
3. Qu'est-ce qui t'a fait perdre du temps ?
4. As-tu dû demander de l'aide ?
5. Y a-t-il un écran que tu évites ?
6. As-tu eu peur de faire une mauvaise action ?
7. Les clients comprennent-ils leur carte ?
8. Les clients demandent-ils souvent comment l'ouvrir ?
9. Utilises-tu plutôt le QR ou la recherche manuelle ?
10. As-tu utilisé des récompenses ?
11. As-tu eu des problèmes de réseau ou de caméra ?
12. Quelle fonction t'a réellement manqué ?
13. Si Retiko disparaissait demain, qu'est-ce qui te manquerait ?

Les demandes de fonctionnalités sont des signaux à analyser, pas des tickets automatiques.

---

# 18. Fiche d'observation par tâche

À dupliquer pour les tâches importantes.

- **Tâche :**
- **Réussite :** Oui / Partielle / Non
- **Aide requise :** Oui / Non
- **Gravité UX :** 0 / 1 / 2 / 3 / 4
- **Hésitation observée :**
- **Erreur / retour arrière :**
- **Confiance exprimée (optionnel, 1–5) :**
- **Verbatim exact :**
- **Contexte :**

La note de confiance est un indice qualitatif, pas un seuil automatique de GO.

---

# 19. Fiche incident

- **Contexte :**
- **Tâche :**
- **Action utilisateur :**
- **Résultat réel :**
- **Résultat perçu :**
- **Impact sur le service :**
- **Intervention nécessaire :**
- **Reproductible :** Oui / Non / Non testé
- **Preuve technique disponible :**
- **Verbatim :**

---

# 20. Gravité UX

## 0 — Aucune friction
Tâche fluide et comprise.

## 1 — Mineure
Hésitation légère, résolue seul, sans effet métier.

## 2 — Modérée
Erreur ou retour arrière, résolu seul, impact limité.

## 3 — Majeure
Besoin d'aide extérieure, blocage important ou interruption notable du flux.

## 4 — Critique / NO-GO potentiel
Tâche critique impossible, résultat dangereux ou ambigu, mauvaise opération métier probable, ou état succès/échec impossible à déterminer avec confiance.

La gravité est analysée avec le contexte. Elle ne remplace pas la reproduction ni la preuve technique.

---

# 21. GO / NO-GO UX

Pas de score global arbitraire.

Évaluer au minimum :

### Fonctions critiques
- inscription ;
- crédit ;
- redeem ;
- historique / vérification.

### Autonomie
Le commerçant peut utiliser les fonctions quotidiennes sans accompagnement permanent.

### Confiance
Après une action sensible, il comprend si elle a réussi ou échoué.

### Rush
Retiko ne bloque pas le flux normal de caisse.

### Erreurs
Aucune erreur silencieuse ni ambiguïté susceptible de provoquer une mauvaise opération.

### Interprétation

**NO-GO** si un problème critique reproduit empêche un parcours essentiel ou rend l'état d'une opération sensible ambigu/dangereux.

**GO avec réserves** si les fonctions critiques sont maîtrisées mais que des frictions importantes identifiées doivent être corrigées ou surveillées.

**GO UX** si les parcours critiques sont autonomes, compris et compatibles avec le service réel, tout en documentant les améliorations non bloquantes.

Un incident de gravité 3 ne déclenche pas automatiquement un NO-GO : il doit être analysé selon sa répétabilité, son impact et le parcours concerné.

---

# 22. Transformer les observations en GitHub

Avant toute issue :

1. vérifier le code actuel ;
2. vérifier #88 ;
3. rechercher issue/PR existante ;
4. distinguer bug, UX, demande de fonctionnalité et problème terrain.

### Création immédiate
- erreur critique reproductible ;
- mauvaise opération métier probable ;
- succès/échec ambigu sur une action sensible ;
- blocage du parcours critique.

### Ticket P1 probable
- friction majeure répétée ;
- besoin d'aide fréquent ;
- problème de rush confirmé ;
- incompréhension répétée avec impact métier.

### Observation à conserver
- friction mineure isolée ;
- préférence esthétique ;
- feature request d'un seul commerce ;
- suggestion sans preuve d'impact.

Ne classer aucune observation comme « non-problème » uniquement parce qu'elle n'est pas encore un ticket.

---

# 23. Triangulation

Une bonne recommandation combine autant que possible :

- observation ;
- verbatim ;
- donnée produit/technique ;
- reproduction.

Exemple :

```text
Observation :
plusieurs employés recliquent sur Crédit.

Verbatim :
« Je savais pas si c'était passé. »

Donnée :
réponse réseau lente sur les mêmes actions.

Reproduction :
attente serveur visible.

Conclusion :
améliorer ou corriger le feedback pendant attente.
```

---

# 24. Rapport final pilote

## Métadonnées

- Commerce :
- Secteur :
- Taille équipe :
- Fidélité précédente :
- Date :
- Appareil scanner :
- Appareil client :
- OS / navigateur :

## Parcours

Pour chaque tâche :
- réussite ;
- aide ;
- gravité ;
- confiance éventuelle ;
- verbatim ;
- note.

## Service réel

- volume observé ;
- scans ;
- recherches manuelles ;
- redeem ;
- incidents ;
- interventions.

## Incidents majeurs

Pour chaque incident :
- contexte ;
- impact ;
- reproduction ;
- preuve technique ;
- statut.

## Verbatims clés

Conserver les formulations brutes.

## Recommandations triangulées

```text
Problème
→ observation
→ verbatim
→ donnée/reproduction
→ action proposée
```

## Décision UX

- GO
- GO avec réserves
- NO-GO

Justification factuelle obligatoire.

---

# 25. Règle finale

Le testeur n'est pas là pour prouver que Retiko est bon.

Il cherche où un vrai commerçant :

- se trompe ;
- hésite ;
- dépend encore de nous ;
- ne comprend pas le résultat ;
- perd du temps pendant son service.

Le meilleur résultat est une preuve exploitable pour décider quoi corriger avant le commerce suivant.

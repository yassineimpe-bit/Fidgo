# Kit pilote UX Retiko

> Fiches terrain courtes à imprimer pour le commerce pilote.
>
> Ce kit complète :
> - `docs/protocole-ux-pilote-retiko.md`
> - `docs/protocole-validation-physique-retiko.md`
>
> Il ne remplace aucun gate technique, test physique, mesure p95 ni audit du ledger.

---

## FICHE 1 — CHECKLIST AVANT PILOTE

**Commerce :** ________________________  
**Date :** ___/___/202_  
**Testeur :** ________________________

### Commerce

- **Nom :** ____________________________________________
- **Secteur :** ________________________________________
- **Adresse :** ________________________________________
- **Contact :** ________________________________________
- **Taille équipe :** __________________________________
- **Système fidélité précédent :** ______________________

### Environnement

- [ ] Production opérationnelle
- [ ] `/api/health` vert
- [ ] Migrations appliquées
- [ ] Compte e-mail accessible
- [ ] Monitoring disponible
- [ ] Sauvegarde récente connue
- [ ] Environnement de test/pilote identifié

### Appareils

- **Smartphone commerçant :** ___________________________
- **OS commerçant :** __________________________________
- **Navigateur / PWA :** _______________________________
- **Smartphone client :** ______________________________
- [ ] Réseau disponible (Wi-Fi ou 4G/5G)
- [ ] Câble / chargeur prévu si nécessaire

### État produit

- [ ] #170 — Scanner Rush Mode mergée
- [ ] #172 — Confirmation Redeem mergée
- [ ] Tests automatiques verts
- [ ] Protocoles UX et technique imprimés
- [ ] Compte de test supprimé ou identifié

---

## FICHE 2 — SCRIPT D’OBSERVATION

**Commerce :** ________________________  
**Date :** ___/___/202_  
**Testeur :** ________________________

### Ce que je dis

> Aujourd’hui, c’est Retiko qu’on teste, pas toi. Je vais te donner des situations réelles et te laisser faire. Je vais peu intervenir pour voir ce qui est clair ou non.

### Consignes métier

1. **Compte**  
   > Crée ton compte Retiko et prépare ton programme comme si tu voulais l’utiliser aujourd’hui.

2. **Commerce**  
   > Personnalise Retiko pour qu’un client reconnaisse ton commerce.

3. **Programme**  
   > Configure ton programme comme ton vrai programme de fidélité.

4. **QR**  
   > Fais en sorte qu’un client puisse obtenir sa carte.

5. **Crédit**  
   > Ce client vient d’acheter. Ajoute sa fidélité.

6. **Récompense**  
   > Ce client veut utiliser sa récompense.

7. **Employé**  
   > Tu commences ton service. Utilise Retiko pour les clients.

### Ce que je ne dis pas

- « Clique ici »
- « Ouvre le menu »
- « Le bouton est en bas »
- « Normalement tu dois… »
- « C’est facile non ? »

### Quand j’interviens

Uniquement en cas de :

- [ ] Blocage réel
- [ ] Demande explicite d’aide
- [ ] Risque de mauvaise opération
- [ ] Abandon imminent

Toute intervention est notée comme une friction.

### Mémo gravité UX

- **0** — aucune friction
- **1** — hésitation légère, résolue seul
- **2** — erreur / retour arrière, résolu seul
- **3** — besoin d’aide ou interruption importante
- **4** — parcours critique impossible ou résultat dangereux / ambigu

---

## FICHE 3 — SESSION 1 : AUTONOMIE

**Commerce :** ________________________  
**Date :** ___/___/202_  
**Testeur :** ________________________

| Étape | Réussi seul | Aide | Gravité 0–4 | Hésitation / erreur | Verbatim |
|---|---|---|---:|---|---|
| Signup | [ ] | [ ] | | | |
| Vérification e-mail | [ ] | [ ] | | | |
| Commerce / branding | [ ] | [ ] | | | |
| Programme — confiance 1–5 : ___ | [ ] | [ ] | | | |
| Expliquer son programme | [ ] | [ ] | | | |
| Trouver QR inscription | [ ] | [ ] | | | |
| Inscription client | [ ] | [ ] | | | |
| Comprendre carte client | [ ] | [ ] | | | |
| Trouver Scanner | [ ] | [ ] | | | |
| Premier crédit — confiance 1–5 : ___ | [ ] | [ ] | | | |
| Récompense si disponible — confiance 1–5 : ___ | [ ] | [ ] | | | |
| Historique si demandé | [ ] | [ ] | | | |

**Confiance :** 1 = pas du tout sûr ; 5 = totalement sûr.  
Cette note reste qualitative et ne constitue pas un gate automatique.

---

## FICHE 4 — SESSION 2 : SERVICE / RUSH

**Commerce :** ________________________  
**Date :** ___/___/202_  
**Tranche :** ___ h ___ → ___ h ___  
**Testeur :** ________________________  
**Employé observé :** _________________  
**Appareil :** ________________________

### Mesures

| Mesure | Valeur |
|---|---:|
| Clients observés | |
| Scans | |
| Recherches manuelles | |
| Redeems | |
| Erreurs de bouton | |
| Hésitations visibles | |
| Interventions | |
| Incidents réseau | |
| Incidents caméra | |

### Événements notables

1. **Heure :** _____  
   **Contexte :** _______________________________________  
   **Comportement :** ___________________________________  
   **Résultat perçu :** _________________________________

2. **Heure :** _____  
   **Contexte :** _______________________________________  
   **Comportement :** ___________________________________  
   **Résultat perçu :** _________________________________

3. **Heure :** _____  
   **Contexte :** _______________________________________  
   **Comportement :** ___________________________________  
   **Résultat perçu :** _________________________________

4. **Heure :** _____  
   **Contexte :** _______________________________________  
   **Comportement :** ___________________________________  
   **Résultat perçu :** _________________________________

5. **Heure :** _____  
   **Contexte :** _______________________________________  
   **Comportement :** ___________________________________  
   **Résultat perçu :** _________________________________

---

## FICHE 5 — INCIDENT UX

**ID incident :** ______  
**Date / heure :** ___/___/202_ — ___ h ___  
**Commerce :** ________________________  
**Testeur :** ________________________  
**Utilisateur :** ____________________  
**Rôle :** OWNER / MANAGER / EMPLOYEE  
**Appareil :** _______________________  
**Écran :** __________________________  
**Tâche :** __________________________

### Contexte

________________________________________________________

### Action réalisée

________________________________________________________

### Résultat réel

________________________________________________________

### Résultat perçu

________________________________________________________

### Qualification

**Impact service**

- [ ] Aucun
- [ ] Léger ralentissement
- [ ] Interruption
- [ ] Mauvaise opération potentielle
- [ ] Mauvaise opération confirmée

**Aide nécessaire**

- [ ] Aucune
- [ ] Collègue
- [ ] Manager
- [ ] Testeur
- [ ] Support

**Gravité UX**

- [ ] 0
- [ ] 1
- [ ] 2
- [ ] 3
- [ ] 4

**Reproduction**

- [ ] Oui
- [ ] Non
- [ ] Pas encore testée

**Preuve disponible**

- [ ] Screenshot
- [ ] Vidéo
- [ ] Log
- [ ] Transaction
- [ ] Métrique
- [ ] Aucune

### Verbatim exact

> ________________________________________________________

---

## FICHE 6 — SESSION 3 : RETOUR À FROID

**Commerce :** ________________________  
**Date :** ___/___/202_  
**Testeur :** ________________________

1. **Qu’as-tu utilisé le plus ?**  
   ______________________________________________________

2. **Qu’est-ce que tu n’as jamais utilisé ?**  
   ______________________________________________________

3. **Qu’est-ce qui t’a fait perdre du temps ?**  
   ______________________________________________________

4. **As-tu dû demander de l’aide ?**  
   ______________________________________________________

5. **Y a-t-il un écran que tu évites ?**  
   ______________________________________________________

6. **As-tu eu peur de faire une mauvaise action ?**  
   ______________________________________________________

7. **Les clients comprennent-ils leur carte ?**  
   ______________________________________________________

8. **Les clients demandent-ils souvent comment l’ouvrir ?**  
   ______________________________________________________

9. **Utilises-tu plutôt QR ou recherche manuelle ?**  
   ______________________________________________________

10. **As-tu utilisé des récompenses ?**  
    _____________________________________________________

11. **As-tu eu des problèmes réseau ou caméra ?**  
    _____________________________________________________

12. **Quelle fonction t’a réellement manqué ?**  
    _____________________________________________________

13. **Si Retiko disparaissait demain, qu’est-ce qui te manquerait ?**  
    _____________________________________________________

---

## FICHE 7 — DÉCISION UX : COMMERCE PILOTE

**Commerce :** ________________________  
**Date :** ___/___/202_  
**Testeur :** ________________________

### Fonctions critiques

- [ ] Inscription client comprise
- [ ] Crédit autonome
- [ ] Redeem autonome
- [ ] Historique compréhensible
- [ ] Résultat succès / échec clair
- [ ] Service possible sans support permanent

### Bilan des incidents

- **Nombre de gravités 4 :** _____
- **Nombre de gravités 3 :** _____
- **Incidents reproductibles critiques :** _____

Ces nombres n'imposent pas automatiquement le verdict.

### Signaux positifs

________________________________________________________

### Réserves

________________________________________________________

### Bloquants

________________________________________________________

### Verdict

- [ ] GO
- [ ] GO AVEC RÉSERVES
- [ ] NO-GO

### Justification

Basée sur observations, verbatims, reproduction et données disponibles :

________________________________________________________

- [ ] Protocole physique exécuté séparément

# Retiko — Politique cookies et traceurs

Version : **2026-09-20**

## Principe

Retiko applique une logique de minimisation : aucun bandeau de consentement n’est affiché tant que seuls des traceurs strictement nécessaires au service sont utilisés.

## Traceurs actuellement nécessaires

Peuvent notamment être utilisés pour :

- maintenir une session authentifiée ;
- sécuriser l’authentification et limiter les abus ;
- mémoriser certains choix techniques attendus ;
- assurer le fonctionnement de la PWA et du service demandé.

Ces mécanismes ne doivent pas être détournés à des fins publicitaires ou de profilage.

## Traceurs soumis au consentement

Avant d’activer un pixel publicitaire, un outil de reciblage, un réseau social ou une mesure d’audience qui ne remplit pas les conditions d’exemption, Retiko doit :

1. bloquer le traceur avant le consentement ;
2. informer clairement sur sa finalité et les acteurs concernés ;
3. offrir **Accepter** et **Refuser** avec une facilité comparable ;
4. conserver la preuve du choix lorsque nécessaire ;
5. permettre le retrait du consentement aussi facilement que son octroi ;
6. mettre à jour la présente politique.

## Mesure d’audience

Une solution de mesure d’audience ne sera exemptée de consentement que si sa configuration respecte réellement les critères applicables de la CNIL. L’étiquette « analytics » n’est pas un passe-droit magique.

## Revue

Toute nouvelle dépendance frontend susceptible d’écrire ou de lire un identifiant terminal doit faire l’objet d’une revue cookies/traceurs avant activation en production.

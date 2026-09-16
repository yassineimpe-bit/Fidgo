# Procédure interne — violation de données personnelles

Procédure à suivre en cas de suspicion ou de confirmation d'une violation de données (accès non autorisé, fuite, perte, altération).

## 1. Contenir (immédiat)

- couper l'accès compromis : révoquer la session ou désactiver le compte staff concerné (`Dashboard → Équipe`, ou changer `AUTH_SECRET` en dernier recours si une compromission globale des sessions est suspectée) ;
- si une clé d'API tierce est compromise (Resend, Stripe, Google/Apple Wallet), la révoquer immédiatement depuis le fournisseur concerné et en générer une nouvelle dans Vercel.

## 2. Évaluer

- quelles données sont concernées (identité, email, historique de fidélité — jamais de mot de passe en clair ni de token de carte brut, qui ne sont jamais journalisés) ;
- combien de personnes sont concernées, sur quel(s) commerce(s) ;
- consulter les journaux `RETIKO_SERVER_ERROR` / `RETIKO_CLIENT_ERROR` et les `audit_logs` pour reconstituer la chronologie.

## 3. Notifier

- **Sous 72h** : si la violation présente un risque pour les droits et libertés des personnes, notifier l'autorité de contrôle compétente (CNIL en France).
- **Sans délai injustifié** : si le risque est élevé, informer directement les personnes concernées.
- **Le(s) commerce(s) concerné(s)** : Retiko notifie immédiatement tout commerce dont les clients sont affectés, conformément à `ANNEXE-SOUS-TRAITANCE-RGPD.md` — le commerce reste responsable de traitement et peut avoir ses propres obligations de notification.

## 4. Documenter

Conserver une trace écrite de :

- nature de la violation et données concernées ;
- personnes et commerces affectés ;
- mesures de confinement prises et à quelle heure ;
- notifications effectuées (autorité, personnes, commerces) et à quelle date.

Cette documentation doit être conservée même si la violation n'est finalement pas notifiée (le RGPD exige une trace de l'analyse, pas seulement des violations notifiées).

## 5. Corriger

Traiter la cause racine avant de considérer l'incident clos (ex. faille corrigée et testée, rotation de tous les secrets potentiellement exposés, migration corrective appliquée).

## Contacts

- CNIL (notification en ligne) : https://www.cnil.fr/fr/notifier-une-violation-de-donnees-personnelles
- Contact interne Retiko : [adresse email de contact]

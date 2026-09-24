# Politique de confidentialité — modèle

> Modèle de travail. À faire relire par un avocat avant publication. Reflète le fonctionnement réel décrit dans `docs/RGPD.md` : ne pas publier une version qui promet plus que ce que le produit fait réellement.

Dernière mise à jour : [date].

## 1. Qui traite vos données

Deux traitements coexistent sur Retiko :

- **Compte commerçant** (restaurateur qui utilise Retiko) : Retiko est responsable de traitement.
- **Carte de fidélité client** (client final d'un commerce partenaire) : le **commerce** est responsable de traitement, Retiko agit comme sous-traitant technique.

## 2. Données collectées

### Compte commerçant

- email, mot de passe (haché, jamais stocké en clair) ;
- nom du commerce, logo, couleur, adresse, téléphone, réseaux sociaux (facultatifs) ;
- journal des connexions et actions (audit).

### Carte de fidélité client

- email (obligatoire pour permettre la récupération de la carte ; il ne peut être utilisé pour des communications marketing du commerce qu'en cas de consentement explicite séparé) ;
- prénom et téléphone (facultatifs) ;
- consentement marketing (case décochée par défaut, séparée de la création de la carte) ;
- solde de fidélité et historique des passages (tampons/points, récompenses).

Aucune donnée bancaire n'est collectée par Retiko pour le programme de fidélité.

## 3. Ce que nous ne stockons jamais en clair dans les journaux techniques

Mot de passe, jeton de session, jeton de carte, lien de récupération, secret d'API ou email complet dans les journaux d'erreur. Les segments d'URL opaques et UUID sont également masqués avant journalisation : voir `docs/OBSERVABILITY.md`.

## 4. Base légale et finalité

- exécution du contrat (fonctionnement de la carte de fidélité, du compte commerçant) ;
- consentement explicite pour toute communication marketing du commerce vers ses clients ;
- intérêt légitime pour la sécurité (anti-fraude, anti-bruteforce, journal d'audit).

## 5. Durée de conservation

- carte client : conservée tant que le compte du commerce est actif, ou jusqu'à demande de suppression ;
- après suppression demandée, les données d'identification (email, téléphone, prénom) sont effacées et la carte désactivée ; l'historique des transactions est conservé sous forme pseudonymisée pour préserver l'intégrité du registre de fidélité et les besoins de sécurité/antifraude ;
- compte commerçant : conservé pendant la durée de la relation contractuelle.

## 6. Vos droits

Vous pouvez demander l'accès, la rectification, l'effacement ou l'export de vos données en contactant directement le commerce chez qui vous avez une carte de fidélité (responsable de traitement), ou Retiko à [adresse email de contact] pour les données de compte commerçant. Voir la procédure détaillée dans `RGPD_PROCEDURES.md`.

## 7. Sous-traitants techniques

- **Vercel** — hébergement applicatif ;
- **Neon** — base de données PostgreSQL ;
- **GitHub** — sauvegardes quotidiennes chiffrées de la base ;
- **Resend** — envoi des emails de récupération de carte et de réinitialisation, une fois activé ;
- **Google** — carte dans Google Wallet, si vous choisissez de l'y ajouter et une fois activé ;
- **Apple** — mises à jour des cartes Apple Wallet, si vous choisissez de l'y ajouter et une fois activé.

Cette liste est tenue à jour dans `docs/REGISTRE_TRAITEMENTS.md` et n'inclut que les sous-traitants réellement activés en production.

## 8. Sécurité

Retiko applique des mesures techniques raisonnables : mots de passe hachés, sessions révocables, limitation de débit anti-bruteforce, isolation stricte des données entre commerces, chiffrement en transit (HTTPS).

## 9. Récupération de carte

Une demande de récupération de carte ne révèle jamais si une adresse email est associée à une carte : la réponse est identique dans tous les cas. Voir `docs/RGPD.md` et `docs/PILOT.md`.

## 10. Contact

Pour toute question relative à cette politique : [adresse email de contact].

# Annexe de sous-traitance RGPD — modèle

> Modèle de travail annexé à `ACCORD-PILOTE.md`. À faire relire par un avocat avant signature.

Entre **[Nom du commerce]** (responsable de traitement) et **Retiko** (sous-traitant), au sens de l'article 28 du RGPD.

## 1. Nature et finalité du traitement

Retiko héberge et exploite techniquement le programme de fidélité digitale du Commerce : création de cartes, crédit/débit de points ou tampons, consultation de solde, récupération de carte par email.

## 2. Durée

La durée du traitement correspond à la durée de l'accord pilote (`ACCORD-PILOTE.md`), reconductions tacites comprises (mécanisme « Jour 31 »).

## 3. Catégories de données traitées

- identité du client final : prénom (facultatif), email (obligatoire), téléphone (facultatif) ;
- données du programme : solde, historique de passages, récompenses consommées ;
- consentement marketing (opt-in explicite, séparé de la création de carte).

## 4. Catégories de personnes concernées

Les clients finaux du Commerce inscrits au programme de fidélité, et le personnel du Commerce disposant d'un accès caisse (email professionnel, rôle).

## 5. Obligations de Retiko (sous-traitant)

Retiko s'engage à :

- ne traiter les données que sur instruction documentée du Commerce ;
- garantir la confidentialité des personnes autorisées à traiter les données ;
- appliquer des mesures de sécurité techniques raisonnables : mots de passe hachés, isolation stricte des données entre commerces (`establishment_id`), limitation de débit anti-bruteforce, sessions révocables, HTTPS ;
- ne pas transférer les données hors de l'Union européenne sans en informer le Commerce ;
- notifier le Commerce sans délai excessif en cas de violation de données concernant ses clients (voir `PROCEDURE-VIOLATION-DONNEES.md`) ;
- assister le Commerce dans l'exercice des droits des personnes concernées (accès, rectification, effacement, export) ;
- restituer ou supprimer l'ensemble des données à l'issue du contrat, sur demande du Commerce.

## 6. Sous-traitants ultérieurs

Retiko peut recourir aux sous-traitants ultérieurs suivants, listés uniquement s'ils sont réellement activés :

- Vercel (hébergement applicatif, région [fra1]) ;
- Neon (base de données PostgreSQL) ;
- Resend (emails de récupération de carte, une fois activé).

Tout nouveau sous-traitant ultérieur est communiqué au Commerce avant son activation.

## 7. Gestion des incidents

Voir `PROCEDURE-VIOLATION-DONNEES.md`. Toute violation de données susceptible d'affecter les clients du Commerce lui est notifiée dans les meilleurs délais.

## 8. Droits des personnes concernées

Le Commerce reste l'interlocuteur des personnes concernées pour l'exercice de leurs droits. Retiko fournit les moyens techniques nécessaires (export JSON, effacement) via le tableau de bord.

## 9. Restitution et suppression en fin de contrat

À l'issue de l'accord pilote (`ACCORD-PILOTE.md`), le Commerce peut demander l'export intégral de ses données ou leur suppression définitive, selon la procédure décrite dans `PROCEDURE-EXPORT-SUPPRESSION.md`.

## 10. Signatures

| Retiko (sous-traitant) | Le Commerce (responsable de traitement) |
|---|---|
| [Nom, fonction, date] | [Nom, fonction, date] |

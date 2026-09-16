# Documents juridiques pilote — modèles

Ces documents sont des **modèles de travail**, pas des documents juridiques validés. Ils doivent être relus par un avocat avant tout envoi à un commerce pilote ou publication publique. Ils reflètent le fonctionnement réel du produit tel que décrit dans `docs/RGPD.md`, `docs/PILOT.md` et `SPEC-V0.md` : ne pas les faire diverger sans mettre à jour ces trois documents en parallèle.

Modèle de répartition RGPD retenu pour la fidélité :

- le **commerce** est responsable de traitement pour les données de son programme de fidélité (clients, cartes, transactions) ;
- **Retiko** agit comme sous-traitant pour ces données, et reste responsable de traitement pour ses propres données SaaS (compte commerçant, support, facturation).

Modèle économique pilote retenu :

- 30 jours gratuits à compter de la création du compte ;
- passé ce délai, le programme continue gratuitement tant qu'aucune des deux parties ne demande l'arrêt ;
- préavis de 15 jours en cas d'arrêt, du côté de Retiko comme du côté du commerce.

## Documents

- `MENTIONS-LEGALES.md` — mentions légales du site (à compléter avec l'identité de l'éditeur).
- `POLITIQUE-CONFIDENTIALITE.md` — politique de confidentialité publique, couvrant le compte commerçant ET le programme de fidélité client.
- `ACCORD-PILOTE.md` — accord commercial pilote entre Retiko et un commerce.
- `ANNEXE-SOUS-TRAITANCE-RGPD.md` — annexe RGPD de sous-traitance jointe à l'accord pilote.
- `PROCEDURE-EXPORT-SUPPRESSION.md` — procédure interne pour traiter une demande d'export ou de suppression de données personnelles.
- `PROCEDURE-VIOLATION-DONNEES.md` — procédure interne en cas de violation de données personnelles (notification CNIL / personnes concernées).

Champs entre crochets `[...]` = à compléter avant tout usage réel (identité légale, adresse, hébergeurs effectivement sous contrat, etc.).

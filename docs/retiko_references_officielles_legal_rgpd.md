# Retiko — Références officielles pour le chantier légal & RGPD

> **But du document**  
> Aider Claude à finaliser l’issue Retiko **#131** à partir de sources officielles françaises, sans inventer de règles ni d’informations juridiques.
>
> **Important**  
> Ce document est une synthèse de travail, pas un avis juridique.  
> Quand une règle dépend de la situation exacte de Retiko ou du statut du client, Claude doit laisser le point **À VALIDER JURIDIQUEMENT** plutôt que trancher sans preuve.

---

## 1. Sources officielles à utiliser

### Source A — Ministère de l’Économie : RGPD, mode d’emploi

**Titre :** Le règlement général sur la protection des données (RGPD), mode d’emploi  
**Source :** Ministère de l’Économie, des Finances et de la Souveraineté industrielle, énergétique et numérique  
**Date indiquée :** 7 août 2025  
**URL :**  
https://www.economie.gouv.fr/entreprises/gerer-son-entreprise-au-quotidien/assurer-sa-cybersecurite-et-la-protection-de-ses/le

### Source B — Service Public Entreprendre : Conditions générales de vente

**Titre :** Conditions générales de vente (CGV)  
**Source :** Entreprendre Service Public / Direction de l’information légale et administrative  
**Date de vérification indiquée :** 1er juillet 2026  
**URL :**  
https://entreprendre.service-public.gouv.fr/vosdroits/F33527

---

# 2. Ce que la source RGPD impose comme cadre de travail

Le RGPD s’applique aux structures qui collectent ou traitent des données personnelles dans l’Union européenne. Il concerne également les sous-traitants qui traitent des données pour le compte d’une autre entité.

Une donnée personnelle est une information concernant une personne physique identifiée ou identifiable. L’identification peut être directe ou indirecte, par exemple via le nom, une adresse e-mail ou d’autres identifiants.

Le traitement ne se limite pas au stockage informatique. La collecte, la consultation, la modification, l’utilisation ou la conservation de données personnelles constituent également des traitements.

## Socle de conformité mis en avant par la source officielle

La source rappelle quatre actions essentielles recommandées par la CNIL :

1. **Tenir un registre des traitements**
   - identifier les traitements de données ;
   - documenter leur finalité et leur fonctionnement ;
   - conserver une vision claire des traitements réalisés.

2. **Minimiser les données**
   - ne collecter que ce qui est nécessaire ;
   - éviter les conservations inutiles ;
   - prévoir des mécanismes d’effacement ou d’archivage.

3. **Respecter les droits des personnes**
   - informer les personnes au moment de la collecte ;
   - faciliter l’accès ;
   - permettre la rectification ;
   - permettre la suppression ;
   - traiter l’opposition lorsqu’elle est applicable.

4. **Sécuriser les données**
   - mesures techniques adaptées ;
   - mots de passe robustes ;
   - sauvegardes ;
   - contrôles d’accès ;
   - mesures organisationnelles et sensibilisation du personnel.

---

# 3. Application concrète au produit Retiko

Claude doit confronter les documents juridiques au **fonctionnement réel du code**.

## A. Registre des traitements

Le registre Retiko doit au minimum distinguer les cas dans lesquels Retiko agit :

### Retiko comme responsable de traitement

À vérifier dans le code et documenter lorsque réellement applicable :

- comptes commerçants ;
- comptes staff ;
- authentification ;
- vérification e-mail ;
- sécurité et audit ;
- administration de la plateforme ;
- facturation Retiko ;
- support ;
- monitoring technique ;
- sauvegardes.

### Retiko comme sous-traitant

Pour les traitements effectués pour le compte du commerce, notamment le programme de fidélité client.

Pour chaque traitement documenté, rechercher et renseigner :

- finalité ;
- personnes concernées ;
- catégories de données ;
- base légale proposée ;
- destinataires ;
- fournisseurs / sous-traitants ;
- durée de conservation ;
- mesures de sécurité ;
- éventuels transferts hors UE.

**Ne pas inventer une base légale incertaine.**  
Utiliser **À VALIDER JURIDIQUEMENT** si le choix dépend d’une analyse juridique.

---

# 4. Minimisation et conservation des données

La source du ministère demande de ne collecter que les données nécessaires et d’éviter leur conservation inutile.

Pour Retiko, Claude doit donc auditer concrètement :

- données demandées au signup commerçant ;
- données du staff ;
- données d’un client fidélité ;
- données d’une carte ;
- logs ;
- audit logs ;
- transactions ;
- historique ;
- données de facturation ;
- sauvegardes ;
- données des établissements fermés ;
- données des clients inactifs.

Il faut distinguer trois états :

1. **durée déjà appliquée techniquement** ;
2. **durée documentée mais mécanisme non activé en production** ;
3. **durée non décidée**.

Il est interdit d’écrire qu’une suppression automatique existe si le mécanisme correspondant est désactivé.

Les durées non déterminées doivent rester marquées :

**À DÉCIDER / À VALIDER JURIDIQUEMENT**

---

# 5. Droits des personnes

La documentation Retiko doit être cohérente avec les fonctions réellement disponibles.

Claude doit vérifier dans le code les mécanismes concernant :

- accès aux données ;
- export ;
- rectification ;
- suppression ;
- anonymisation ;
- opposition ;
- limitation lorsque applicable ;
- portabilité lorsque applicable.

Le texte public ne doit jamais promettre une fonction qui n’existe pas.

La procédure de demande RGPD doit préciser :

- canal de contact ;
- données permettant d’identifier la demande ;
- traitement de la demande ;
- cas commerçant / client final ;
- rôle respectif du commerce et de Retiko.

Le contact RGPD doit rester **[À COMPLÉTER]** si aucune adresse officielle n’a encore été décidée.

---

# 6. Sécurité et RGPD

La source officielle cite notamment les mots de passe robustes, sauvegardes et contrôles d’accès parmi les mesures de sécurité.

Pour Retiko, Claude peut documenter uniquement ce que le repo permet de vérifier, par exemple :

- contrôle d’accès ;
- isolation des établissements ;
- rôles OWNER / MANAGER / EMPLOYEE ;
- journalisation des actions sensibles ;
- mots de passe hashés ;
- sessions révocables ;
- tokens de vérification et reset hashés ;
- sauvegardes PostgreSQL ;
- tests de restauration ;
- tests IDOR / cross-tenant / XSS / brute force ;
- protections contre double crédit et concurrence.

Ne jamais présenter une mesure comme active en production si elle n’est vérifiée que dans le code ou en test.

---

# 7. Sous-traitants et fournisseurs à auditer

À confronter aux configurations réellement utilisées dans Retiko :

- Vercel ;
- Neon ;
- Resend ;
- Stripe ;
- GitHub ;
- Apple ;
- Google Wallet.

Pour chaque fournisseur, documenter uniquement ce qui est vérifiable :

- usage dans Retiko ;
- catégorie de données potentiellement concernée ;
- actif ou seulement conditionnel ;
- rôle dans la chaîne de traitement ;
- transfert hors UE à étudier lorsque pertinent ;
- DPA ou garantie juridique seulement si elle est réellement vérifiée.

Ne jamais inventer :

- DPA signé ;
- clauses contractuelles types signées ;
- localisation précise non vérifiée ;
- garantie de transfert ;
- durée de conservation contractuelle.

## Point GitHub déjà identifié

Vérifier le workflow actuel de sauvegarde.

Si le dump PostgreSQL complet transite temporairement en clair sur un runner GitHub avant chiffrement de l’artefact, ce traitement doit rester documenté dans le registre et dans la liste des sous-traitants.

---

# 8. CGV : distinction avec les CGU

Service Public rappelle qu’il ne faut pas confondre :

- **CGU** : règles d’utilisation d’un service ou d’un site ;
- **CGV** : cadre commercial de la vente de biens ou de prestations.

Pour Retiko :

- les **CGU** doivent encadrer l’utilisation du service ;
- les **CGV** doivent encadrer la relation commerciale entre Retiko et le commerçant qui souscrit au SaaS.

Ne pas fusionner les deux concepts dans un document ambigu.

---

# 9. CGV B2B : éléments importants pour Retiko

Pour des clients professionnels, la source Service Public indique notamment que les CGV doivent couvrir, lorsqu’elles existent et sont communiquées :

- conditions d’exécution de la prestation ;
- éléments de détermination du prix ;
- éventuelles réductions ;
- conditions de règlement ;
- délais de paiement ;
- pénalités de retard ;
- indemnité forfaitaire pour frais de recouvrement.

## Paiement

Le document Retiko doit donc être cohérent avec :

- abonnement mensuel ;
- abonnement annuel ;
- période d’essai ;
- date / mode de paiement ;
- activation du service ;
- facturation ;
- impayés ;
- suspension ;
- annulation ;
- résiliation.

Le projet Retiko prévoit actuellement des offres pilote autour de :

- 19,99 €/mois ;
- 210 €/an.

Ces montants doivent être repris uniquement s’ils sont toujours ceux du produit lors de la finalisation.

## Retard de paiement

La source Service Public indique que les CGV professionnelles doivent préciser les modalités et le taux des pénalités de retard.

Elle rappelle également l’indemnité forfaitaire de **40 € pour frais de recouvrement** lorsque le paiement professionnel intervient en retard.

La source précise que les pénalités ne peuvent pas être inférieures à trois fois le taux de l’intérêt légal.

**Ne pas figer dans le code un pourcentage temporaire sans vérification.**  
Le taux applicable doit être vérifié à la date de finalisation des CGV.

---

# 10. Attention aux petits professionnels pouvant bénéficier de règles de consommation

Point particulièrement important pour Retiko.

La source Service Public indique qu’un professionnel peut, dans certaines situations, bénéficier de règles normalement applicables aux consommateurs lorsqu’il remplit simultanément trois conditions :

- entreprise de cinq salariés maximum ;
- prestation qui n’entre pas dans son activité principale ;
- contrat conclu à distance ou hors établissement.

Cela peut potentiellement concerner certains petits commerces démarchés pour Retiko.

Claude ne doit pas décider seul que ce régime s’applique ou non.

Créer un point explicite :

**À VALIDER JURIDIQUEMENT AVANT COMMERCIALISATION**

Il faut notamment vérifier l’impact potentiel sur :

- information précontractuelle ;
- droit de rétractation ;
- modalités de résiliation ;
- formulaire / mécanisme de rétractation ;
- clauses applicables.

---

# 11. Vente ou souscription à distance

Pour les situations relevant du droit de la consommation, Service Public liste notamment des informations à fournir avant le contrat :

- caractéristiques essentielles du service ;
- prix ;
- informations sur le professionnel ;
- coordonnées ;
- droit de rétractation lorsqu’il existe ;
- modalités de résiliation ;
- modalités d’exécution ;
- règlement des litiges ;
- médiation lorsqu’elle est applicable.

La source indique également qu’à compter du **19 juin 2026**, les contrats conclus à distance via une interface en ligne avec un consommateur doivent permettre l’exercice du droit de rétractation directement en ligne.

Pour Retiko :

**Ne pas implémenter automatiquement cette fonction pour tous les commerçants.**

D’abord déterminer juridiquement si et dans quels cas les clients Retiko entrent dans le champ de cette obligation.

---

# 12. Clauses déséquilibrées / abusives

Service Public met notamment en garde contre des clauses permettant au professionnel :

- de résilier librement sans droit comparable pour le client ;
- de conserver des sommes dans des conditions déséquilibrées ;
- de supprimer toute responsabilité ;
- de rendre la résiliation beaucoup plus difficile pour le client ;
- de modifier unilatéralement le contrat de manière excessive ;
- d’imposer des pénalités disproportionnées ;
- de couper un abonnement sans préavis raisonnable.

Claude doit donc auditer les projets de CGV #103 et la future version consolidée.

Éviter notamment les formulations du type :

- « Retiko peut résilier à tout moment sans motif » ;
- « aucun remboursement quelles que soient les circonstances » ;
- « Retiko ne peut jamais être responsable » ;
- modification illimitée et immédiate des prix ou du contrat ;
- procédure de résiliation artificiellement plus complexe pour le commerçant.

Toute clause de responsabilité, juridiction ou limitation financière importante doit rester :

**À VALIDER JURIDIQUEMENT**

---

# 13. Informations légales à ne jamais inventer

Avant publication commerciale, les documents pourront nécessiter notamment :

- raison sociale ;
- forme juridique ;
- capital social si applicable ;
- SIREN ;
- SIRET ;
- RCS / RNE si applicable ;
- numéro de TVA si applicable ;
- siège social ;
- adresse de contact ;
- directeur de publication ;
- contact RGPD ;
- DPO si applicable.

Si l’information n’existe pas encore :

**[À COMPLÉTER]**

Ne jamais générer de numéro ou d’identité fictive.

---

# 14. Checklist Claude pour #131

## RGPD

- [ ] registre des traitements présent et cohérent avec le code ;
- [ ] rôle responsable / sous-traitant distingué ;
- [ ] données minimisées ;
- [ ] finalités documentées ;
- [ ] bases légales identifiées ou marquées à valider ;
- [ ] droits documentés ;
- [ ] export vérifié ;
- [ ] suppression/anonymisation vérifiée ;
- [ ] durées de conservation auditées ;
- [ ] fournisseurs documentés ;
- [ ] transferts éventuels identifiés sans extrapolation ;
- [ ] mesures de sécurité cohérentes avec le code ;
- [ ] politique de confidentialité alignée sur le registre.

## CGU / CGV

- [ ] CGU et CGV clairement séparées ;
- [ ] service Retiko décrit ;
- [ ] prix / abonnement cohérents avec le produit ;
- [ ] essai documenté ;
- [ ] paiement documenté ;
- [ ] impayé / suspension documenté ;
- [ ] résiliation documentée ;
- [ ] pénalités de retard B2B documentées ;
- [ ] indemnité forfaitaire de recouvrement traitée ;
- [ ] clauses déséquilibrées recherchées ;
- [ ] statut des petits professionnels / rétractation marqué à valider ;
- [ ] données juridiques inconnues laissées à compléter.

## Produit

- [ ] signup #127 intact ;
- [ ] vérification e-mail intacte ;
- [ ] onboarding intact ;
- [ ] liens juridiques visibles ;
- [ ] consentement contractuel séparé du marketing ;
- [ ] consentement marketing non précoché ;
- [ ] preuve d’acceptation versionnée si implémentée ;
- [ ] aucun secret exposé ;
- [ ] aucune promesse juridique non supportée par le code.

---

# 15. Règle de décision pour Claude

Lorsqu’une information relève :

### du code
→ vérifier le repo et documenter ce qui existe réellement.

### d’une source officielle
→ suivre les sources ci-dessus et citer la règle correspondante dans les notes de PR lorsque utile.

### d’un choix métier
→ ne pas décider silencieusement ; documenter la décision à prendre.

### d’une analyse juridique
→ marquer **À VALIDER JURIDIQUEMENT**.

### d’une identité d’entreprise inconnue
→ marquer **[À COMPLÉTER]**.

---

# 16. Résultat attendu de Claude

La PR finale de #131 doit permettre de répondre clairement :

1. quelles données Retiko collecte ;
2. pourquoi elles sont utilisées ;
3. combien de temps elles sont conservées ;
4. qui y accède ;
5. quels fournisseurs les traitent ;
6. comment une personne exerce ses droits ;
7. quelles règles contractuelles encadrent l’abonnement commerçant ;
8. quelles informations doivent encore être fournies avant commercialisation ;
9. quelles questions nécessitent encore une validation juridique.

La PR ne doit pas transformer une incertitude en affirmation juste pour obtenir une case verte dans #88.

---

## Références

- Ministère de l’Économie — « Le règlement général sur la protection des données (RGPD), mode d’emploi »  
  https://www.economie.gouv.fr/entreprises/gerer-son-entreprise-au-quotidien/assurer-sa-cybersecurite-et-la-protection-de-ses/le

- Entreprendre Service Public — « Conditions générales de vente (CGV) »  
  https://entreprendre.service-public.gouv.fr/vosdroits/F33527


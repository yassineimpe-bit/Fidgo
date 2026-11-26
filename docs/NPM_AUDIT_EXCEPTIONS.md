# Exceptions temporaires de l’audit npm

## GHSA-86w9-cpqp-85rv — CVE-2026-85393

- Dépendance : `node-forge`, introduite transitivement par `passkit-generator`.
- Sévérité : HIGH.
- Introduction de l’exception : 2026-10-02.
- Revue obligatoire au plus tard : 2026-10-16 inclus.
- Justification : Retiko utilise ce chemin pour signer les PKPass. Le défaut touche la vérification RSA PKCS#1 v1.5 et aucun chemin Retiko actuel ne vérifie une signature fournie par un attaquant avec `node-forge`.
- Portée de cette exception : seul l’identifiant exact `GHSA-86w9-cpqp-85rv`, déclaré HIGH sur le paquet `node-forge`, est accepté.
- Suppression : retirer l’exception dès qu’une version corrigée de `node-forge` est publiée et validée via `passkit-generator`.

## GHSA-vfj7-8cjw-p6xm — CVE-2026-93687 (#254)

- Sévérité : HIGH, épuisement de pile sur des motifs d’accolades profondément imbriqués.
- Introduction : 2026-10-03 ; revue/expiration : 2026-10-16 inclus.
- Classification : **DEV-ONLY NON REACHABLE**, pour le main `1dba4213069b4978cce29b292bf26fdcb3f90fcd`.
- Chaîne réelle : `eslint-config-next@15.5.24` → `@next/eslint-plugin-next@15.5.24` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`. Chaque maillon est `dev: true` ; `npm ls braces micromatch fast-glob --omit=dev --all` est vide.
- Atteignabilité vérifiée au-delà du lockfile : aucun import de ces trois paquets ni lancement de lint depuis `app`, `lib`, `components`, le middleware ou les scripts applicatifs. Le plugin appelle `fast-glob.globSync` dans `dist/utils/get-root-dirs.js` avec le répertoire de travail ou `context.settings.next.rootDir` provenant de la configuration ESLint du dépôt. Il ne reçoit pas de requête HTTP, de donnée client/commerçant/staff ni de fichier uploadé comme motif.
- Artefact production : les **106** traces `.next/**/*.nft.json` du build de main ne contiennent aucun des quatre paquets de cette chaîne. La recherche dans le runtime Next installé ne trouve aucun import de `braces`, `micromatch` ou `fast-glob` ; son `compiled/picomatch` est un parseur distinct, pas cette dépendance. Aucun chemin d’entrée utilisateur vers le paquet vulnérable n’est démontré en production.
- Upstream revérifié le 2026-10-03 : [advisory GitHub](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [rapport upstream #70](https://github.com/micromatch/braces/issues/70) et [registre npm braces](https://registry.npmjs.org/braces). Versions affectées ≤ 3.0.3, aucune version corrigée publiée ; latest = 3.0.3.
- Mises à jour de parents vérifiées dans le registre npm : `micromatch@4.0.8` (latest) garde `braces:^3.0.3` ; `fast-glob@3.3.3` garde `micromatch:^4.0.8` ; `@next/eslint-plugin-next@15.5.27` et latest `16.3.8` gardent `fast-glob:3.3.1`. Ces mises à jour n’éliminent pas la chaîne. La suggestion automatique de npm de rétrograder `eslint-config-next` vers 14.2.35 est un changement majeur, pas une correction compatible validée pour Next 15. Aucun override ou changement de dépendance appliqué.
- Portée : uniquement `GHSA-vfj7-8cjw-p6xm`, avec URL canonique exacte, paquet `braces` et sévérité HIGH. Cette décision concerne le déploiement actuel, pas tous les usages possibles de braces ; revalider si une dépendance ou un chemin runtime change.
- Suppression : retirer l’exception dès qu’une version corrigée est publiée et validée via l’outillage de lint.

Seuls ces **deux** identifiants exacts sont acceptés temporairement. Tout autre HIGH et tout CRITICAL font échouer la CI, y compris sur ces mêmes paquets. Le gate expire automatiquement après le 2026-10-16 et échoue alors même si aucun nouvel avis n’est apparu. Le niveau d’audit et le traitement des erreurs restent inchangés.

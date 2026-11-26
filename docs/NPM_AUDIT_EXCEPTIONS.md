# Exceptions temporaires de l’audit npm

**Aucune exception active depuis le 2026-11-26.** `npm run security:audit` rejette toute advisory HIGH ou CRITICAL, directe ou transitive. Le niveau d’audit, le traitement des erreurs et l’expiration automatique des exceptions sont inchangés.

Une nouvelle exception exige :

- une entrée dans `ALLOWED_ADVISORIES` (`scripts/audit-dependencies.mjs`) avec l’identifiant GHSA exact, le paquet, la sévérité, la CVE, la date d’introduction et une date de revue courte ;
- une section ici : chaîne de dépendances réelle, atteignabilité vérifiée, absence de version corrigée, condition de retrait ;
- une validation humaine.

Une exception n’est jamais prolongée automatiquement. À expiration, la CI échoue, même si aucun nouvel avis n’est apparu.

## Historique

### GHSA-86w9-cpqp-85rv — CVE-2026-85393 (`node-forge`) — retirée le 2026-11-26

- Introduite le 2026-10-02, expirée le 2026-10-16.
- Chemin : `passkit-generator` → `node-forge` (signature des PKPass).
- Retrait : `node-forge` 1.4.4 (publiée le 2026-11-23) corrige cette advisory et les sept autres HIGH apparues depuis : GHSA-5x38-2vff-x55p, GHSA-6qrw-m8cv-hcxf, GHSA-7wch-p9px-956x, GHSA-8hrf-8g6f-7xwp, GHSA-hqq3-7jhf-c5jx, GHSA-jc66-7q78-782g, GHSA-rhr8-3pm8-cq29. La version est compatible avec la plage `^1.4.0` de `passkit-generator` 3.6.0.

### GHSA-vfj7-8cjw-p6xm — CVE-2026-93687 (`braces`, #254) — retirée le 2026-11-26

- Introduite le 2026-10-03, expirée le 2026-10-16, classée DEV-ONLY NON REACHABLE (chaîne `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`).
- Retrait : **l’advisory a été retirée par GitHub le 2026-10-23** (« not a practically exploitable vulnerability »). `npm audit` ne la signale plus pour `braces@3.0.3` ; aucune version corrigée n’existe et aucune n’est nécessaire.

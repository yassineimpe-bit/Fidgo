# Exceptions temporaires de l’audit npm

## GHSA-86w9-cpqp-85rv — CVE-2026-85393

- Dépendance : `node-forge`, introduite transitivement par `passkit-generator`.
- Sévérité : HIGH.
- Introduction de l’exception : 2026-10-02.
- Revue obligatoire au plus tard : 2026-10-16 inclus.
- Justification : Retiko utilise ce chemin pour signer les PKPass. Le défaut touche la vérification RSA PKCS#1 v1.5 et aucun chemin Retiko actuel ne vérifie une signature fournie par un attaquant avec `node-forge`.
- Portée : seul l’identifiant exact `GHSA-86w9-cpqp-85rv`, déclaré HIGH sur le paquet `node-forge`, est accepté. Tout autre HIGH et tout CRITICAL font échouer la CI.
- Suppression : retirer l’exception dès qu’une version corrigée de `node-forge` est publiée et validée via `passkit-generator`.

Le gate expire automatiquement après la date de revue et échoue alors même si aucun nouvel avis n’est apparu.

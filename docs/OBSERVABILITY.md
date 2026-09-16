# Observabilité pré-pilote

Retiko utilise les Runtime Logs Vercel comme collecteur d'erreurs de base. Les erreurs serveur non gérées sont émises par `instrumentation.ts` sous la clé `RETIKO_SERVER_ERROR`. Les erreurs navigateur sont envoyées à `/api/client-errors` puis émises sous `RETIKO_CLIENT_ERROR`. Aucune des deux clés ne nécessite de clé Sentry ou d'autre service externe : elles fonctionnent dès que l'application build, avec `console.error` comme seul transport.

Les logs contiennent uniquement :

- nom de l'erreur ;
- empreinte irréversible du message client ;
- route et méthode ;
- chemin normalisé, avec UUID et segments opaques remplacés avant journalisation ;
- référence technique Next.js lorsqu'elle existe ;
- version déployée (`VERCEL_GIT_COMMIT_SHA`, tronquée) ;
- navigateur/appareil via le User-Agent.

Ils ne contiennent pas de mot de passe, JWT, token de carte, lien de récupération ou email client. Les query strings et fragments d'URL sont supprimés avant journalisation.

## Alertes à configurer avant le pilote

- alerte sur erreurs `RETIKO_SERVER_ERROR` pendant les plages critiques ;
- alerte sur hausse de `RETIKO_CLIENT_ERROR` ;
- surveillance de `/api/health` ;
- distinction entre indisponibilité totale et indisponibilité pendant les services du commerce.

Si Sentry est activé plus tard, conserver la même politique de filtrage et désactiver l'envoi automatique de données personnelles.

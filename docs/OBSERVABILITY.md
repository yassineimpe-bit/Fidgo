# Observabilité pré-pilote

Fidgo utilise les Runtime Logs Vercel comme collecteur d'erreurs de base. Les erreurs serveur non gérées sont émises par `instrumentation.ts` sous la clé `FIDGO_SERVER_ERROR`. Les erreurs navigateur sont envoyées à `/api/client-errors` puis émises sous `FIDGO_CLIENT_ERROR`.

Les logs contiennent uniquement :

- nom de l'erreur ;
- empreinte irréversible du message client ;
- route et méthode ;
- référence technique Next.js lorsqu'elle existe ;
- navigateur/appareil via le User-Agent.

Ils ne contiennent pas de mot de passe, JWT, token de carte ou email client.

## Alertes à configurer avant le pilote

- alerte sur erreurs `FIDGO_SERVER_ERROR` pendant les plages critiques ;
- alerte sur hausse de `FIDGO_CLIENT_ERROR` ;
- surveillance de `/api/health` ;
- distinction entre indisponibilité totale et indisponibilité pendant les services du commerce.

Si Sentry est activé plus tard, conserver la même politique de filtrage et désactiver l'envoi automatique de données personnelles.

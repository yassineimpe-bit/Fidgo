# Checklist de test terrain — premier service Retiko

Ce document couvre le premier vrai service d'un commerce pilote, minute par minute. Pour le cadre général du pilote (durée, continuité, incident en cours de service), voir `docs/PILOT.md`.

## Avant service

- [ ] Compte créé et connexion vérifiée (`/login`).
- [ ] Commerce configuré : nom, logo, couleur (`/dashboard/settings`).
- [ ] Programme fidélité configuré : mode, seuil, récompense (`/dashboard/program`).
- [ ] Affiche QR imprimée (`/dashboard/poster`).
- [ ] Retiko installé sur le téléphone/tablette caisse (`/s`, voir bandeau d'installation).
- [ ] Login vérifié sur l'appareil caisse réel, pas seulement sur l'ordinateur du bureau.
- [ ] Une carte de test créée depuis le QR (avec un email dont l'équipe a accès) et présentée au scanner avec succès.
- [ ] Réseau testé sur l'appareil caisse à l'endroit exact où le scan aura lieu (Wi-Fi commerce, pas seulement le 4G du bureau).
- [ ] Recherche par code court testée manuellement (utile si la caméra ou la lumière pose problème en service).

## Pendant service

Mesurer, sans ralentir la file :

- temps perçu entre le scan et le crédit (`/s/stats` donne p50/p95 réels après coup) ;
- erreurs rencontrées par le staff (message affiché, action suivante) ;
- doubles scans (cooldown déclenché, override utilisé et pourquoi) ;
- abandons client (quelqu'un renonce à créer sa carte ou à la présenter) ;
- utilisation du code court en secours (caméra en échec, lumière, réseau) ;
- récompenses atteintes et effectivement utilisées en caisse.

En cas d'incident, suivre la procédure du §"Incident pendant le service" de `docs/PILOT.md` : ne pas ralentir la file, noter le code court, régulariser après coup via Clients → Ajuster.

## Après service

Noter, à chaud si possible :

- nombre d'inscriptions (`/dashboard`, carte "clients inscrits") ;
- nombre de scans réussis / échoués (`/dashboard`, "scans réussis" / "taux d'erreur scanner") ;
- erreurs récurrentes et leur code (aide au diagnostic sans exposer de détail technique au client) ;
- remarques du staff : geste naturel ou confus, écran clair ou non, vitesse perçue ;
- remarques des clients : compréhension du solde, de la récompense, de l'installation Wallet/PWA ;
- bugs critiques : tout ce qui a bloqué un crédit, une récompense ou une inscription légitime.

Ce relevé sert à décider, service après service, si le pilote passe à l'échelle ou doit d'abord être corrigé.

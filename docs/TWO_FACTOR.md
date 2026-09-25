# Double authentification commerçant (TOTP)

Facultative, activée par chaque membre de l'équipe pour son propre compte
depuis **Compte → Sécurité**. Fonctionne avec toute application TOTP
(Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden…) :
HMAC-SHA1, 6 chiffres, pas de 30 s (RFC 6238), sans dépendance externe.

## Parcours

1. **Activer** : mot de passe redemandé, QR code et clé à saisir à la main,
   puis premier code de l'application. La 2FA n'est active qu'après ce code.
2. **Codes de secours** : 10 codes `XXXXX-XXXXX`, affichés une seule fois,
   chacun utilisable une fois. Régénérables avec un code valide.
3. **Connexion** : mot de passe, puis « Code de vérification » ou « Utiliser un
   code de secours ».
4. **Désactiver** : mot de passe + code de l'application ou code de secours.

## Sécurité

| Point | Mise en œuvre |
|---|---|
| Aucune session avant le code | `/api/auth/login` renvoie `twoFactorRequired` et un cookie `loyalty_mfa` (5 min, HttpOnly, `SameSite=Strict`, limité à `/api/auth`) ; la session n'est émise que par `/api/auth/login/verify` |
| Jeton d'attente ≠ session | Signé avec une clé dérivée distincte (HKDF d'`AUTH_SECRET`) : recopié dans le cookie de session, il est rejeté (test E2E) |
| Révélation | La 2FA n'est signalée qu'après un mot de passe correct : aucun oracle d'énumération |
| Rejeu | Dernier pas accepté mémorisé ; mise à jour conditionnelle contre deux requêtes simultanées ; fenêtre ±1 pas |
| Force brute | 5 codes par compte et par quart d'heure (remis à zéro après succès), 20 par IP |
| Changement d'état | Mot de passe changé, compte désactivé ou commerce suspendu entre les deux étapes : `TWO_FACTOR_EXPIRED` |
| Stockage | Secret chiffré AES-256-GCM (clé dérivée d'`AUTH_SECRET`) ; codes de secours en HMAC-SHA256 ; rien en clair |
| Autres appareils | L'activation incrémente `token_version` : les sessions ouvertes ailleurs sans second facteur sont révoquées, la session courante est réémise |
| Audit | `STAFF_TWO_FACTOR_ENABLED`, `STAFF_TWO_FACTOR_DISABLED`, `STAFF_TWO_FACTOR_RECOVERY_REGENERATED`, `LOGIN_TWO_FACTOR_VERIFIED` (méthode seulement) |

## Limites connues

- **Changer `AUTH_SECRET`** rend les secrets TOTP et les codes de secours
  existants inutilisables : les comptes concernés doivent être réinitialisés.
- **Téléphone et codes de secours perdus** : pas de réinitialisation en
  libre-service. Pour un employé, le propriétaire peut désactiver le compte et
  en créer un nouveau ; pour le propriétaire, intervention du support
  (suppression des lignes `staff_two_factor*` du compte après vérification
  d'identité, tracée hors application).
- La 2FA n'est pas imposée par commerce ni par rôle.
- Pas de 2FA par SMS ni par e-mail.

## Déploiement

Migration `025_staff_two_factor.sql`, additive et idempotente. Sans elle, la
connexion reste en un facteur et la section Sécurité indique que la fonction
n'est pas encore disponible.

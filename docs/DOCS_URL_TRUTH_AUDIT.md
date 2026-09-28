# Vérité documentaire — cooldown et URLs terrain

Audit au HEAD `0dac842` (2026-09-27). Corrections limitées aux docs. Aucune logique métier, flag, Stripe, Wallet ou pricing modifié.

PR docs voisine ouverte : #219 (protocole physique seulement). Pas de doublon de branche.

| Sujet | Ancien état | Vérité code | Fichier corrigé | Action |
|---|---|---|---|---|
| Cooldown défaut nouveaux programmes | `docs/ARCHITECTURE.md` : « 120 secondes » | `DEFAULT_COOLDOWN_SECONDS = 600` dans `lib/cooldown.ts` ; signup INSERT utilise cette constante | `docs/ARCHITECTURE.md` | Corrigé |
| Cooldown défaut SQL colonne | `db/schema.sql` : `cooldown_seconds … default 120` | Vrai pour INSERT brut sans colonne | — | Conservé volontairement |
| Préréglage 2 min | `COOLDOWN_PRESETS` contient `120` | Vrai ; option formulaire, pas le défaut signup | — | Conservé volontairement |
| Protocole physique | 10 min nouveaux / 120 s historique | Aligné avec le code | — | Déjà juste |
| SPEC-V0 cooldown | 10 min nouveaux, 2 min jusqu’au 25/09/2026 | Aligné | — | Conservé |
| Domaine canonique | `https://retiko.fr` | `RETIKO_PRODUCTION_ORIGIN` + garde `VERCEL_ENV === "production"` dans `lib/app-url.ts` | — | Conservé |
| `NEXT_PUBLIC_APP_URL` | `https://retiko.fr` dans `.env.example` | Source pour preview/dev ; ignorée en Production Vercel au profit de `retiko.fr` | — | Conservé |
| QR / affiches / e-mails | générés via `getAppUrl()` | Prod Vercel → toujours `https://retiko.fr` | — | Conservé |
| `fidgo-env-probe.vercel.app` | cité comme transition, interdit à l’impression | README + `docs/DEPLOYMENT.md` | — | Conservé (TRANSITION) |
| `postgres://fidgo:fidgo@…/fidgo_test` | `docs/INSTALLATION.md` | Identifiants **locaux de test**, pas une URL produit | — | Conservé (DEV / TEST) |
| Nom de dépôt Fidgo | `yassineimpe-bit/Fidgo` | Nom GitHub historique | — | Conservé |

## Corrigé

- `docs/ARCHITECTURE.md` : défaut applicatif 600 s ; défaut SQL 120 s documenté comme fallback d’INSERT brut.

## Conservé volontairement

- `db/schema.sql` `default 120` : historique, non réécrit (pas de migration de cette mission).
- Preset formulaire 120 s / 2 min.
- Programmes existants : valeur inchangée (commentaire de `lib/cooldown.ts`).
- Exemple Postgres local `fidgo` / `fidgo_test`.
- Mention `fidgo-env-probe.vercel.app` comme endpoint **interdit à l’impression**.

## Source de vérité URL

Unique helper : `getAppUrl()` dans `lib/app-url.ts`.

1. Si `VERCEL_ENV === "production"` → `https://retiko.fr` (ignore une `NEXT_PUBLIC_APP_URL` oubliée ou encore Vercel).
2. Sinon `NEXT_PUBLIC_APP_URL` si définie.
3. Sinon `VERCEL_PROJECT_PRODUCTION_URL` puis `VERCEL_URL` (preview).

Consommateurs terrain concernés : landing (`app/page.tsx`), Checkout/Portal return URLs (`lib/billing.ts`), e-mails (`lib/email.ts` et dérivés), affiches / QR (`/dashboard/poster`, inscription `/j/<slug>` via origine publique).

Aucun second mécanisme concurrent trouvé pour construire l’origine publique.

## Classification URLs

| URL / motif | Classe |
|---|---|
| `https://retiko.fr` | PROD CANONIQUE |
| `https://www.retiko.fr` → apex | PROD CANONIQUE (redirection demandée dans SPEC / DEPLOYMENT) |
| `mailto:contact@retiko.fr`, `cartes@retiko.fr` | PROD CANONIQUE (e-mail) |
| `NEXT_PUBLIC_APP_URL` / `localhost` dans tests et `.env` local | DEV / TEST |
| `fidgo-env-probe.vercel.app` | TRANSITION / VERCEL — interdit QR imprimé |
| `VERCEL_URL` preview | TRANSITION / VERCEL — non utilisé si `VERCEL_ENV=production` |
| identifiants SQL `fidgo` / `fidgo_test` | DEV / TEST |
| nom de repo `Fidgo` | historique GitHub, pas une URL produit |

Aucun exemple prod dans README / PILOT / DEPLOYMENT / SPEC-V0 ne pointe un QR vers `*.vercel.app`.

## À confirmer humainement

- DNS OVH réellement attaché à Vercel pour `retiko.fr` (le code force l’origine en Production Vercel ; le DNS n’est pas vérifiable depuis ce dépôt).
- `www.retiko.fr` redirige bien vers l’apex.
- Variable Vercel Production : `NEXT_PUBLIC_APP_URL=https://retiko.fr` (redondant avec le garde-fou, utile pour `env:check`).

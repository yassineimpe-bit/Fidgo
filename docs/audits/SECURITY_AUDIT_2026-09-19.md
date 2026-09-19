# Audit de sécurité — Fidgo / Retiko

**Dépôt** : `yassineimpe-bit/Fidgo`
**Commit audité** : `1e8effa` (2026-09-18)
**Date de l'audit** : 19 septembre 2026
**Périmètre** : routes `app/api/**`, librairies `lib/**`, pages serveur `app/**`, schéma `db/**`, scripts d'exploitation, configuration Next/Vercel/CI, dépendances npm.

---

## Avis général

Le code est déjà nettement plus durci que la moyenne : requêtes paramétrées partout (aucune concaténation SQL), isolation multi-tenant systématique par `establishment_id`, idempotence avec re-vérification après verrou de ligne, JWT re-validé en base à chaque requête avec `token_version`, protection CSRF par `Origin`/`Sec-Fetch-Site` en fail-closed, CSP avec nonce et `strict-dynamic`, webhook Stripe avec signature + anti-rejeu + contrôle d'appartenance du tenant, aucun `dangerouslySetInnerHTML`, aucun secret commité.

Les 21 points ci-dessous sont donc du durcissement résiduel, pas des trous béants. Deux d'entre eux méritent néanmoins un correctif rapide (§1 et §2).

### État d'avancement

Un premier lot de correctifs a été appliqué et vérifié (patch `docs/audits/fidgo-securite-2026-09-19.patch`, applicable sur `1e8effa` via `git apply`). Les points restants demandent un arbitrage produit, une migration de données ou un test sur environnement réel.

**Vérifications passées sur le code corrigé** : `typecheck` ✅ · `lint` ✅ (1 warning préexistant) · `test` ✅ 117/117 · `build` ✅ · `db:setup` + rejeu ✅ · `db:verify` ✅ · `env:check` ✅ sur les 3 contrats CI · 20 assertions HTTP contre un serveur et une base réels ✅ · contre-épreuve sur §2 : l'ancien code renvoie bien `429` au titulaire légitime là où le code corrigé renvoie `200`.

| # Faille Gravité Fichier principal Statut  |                                                                              |            |                                                 |             |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ---------- | ----------------------------------------------- | ----------- |
| 1                                          | Rétention jamais exécutée + `rate_limits` alimentée par des clés arbitraires | **Élevée** | `lib/rate-limit.ts`, `vercel.json`              | **Corrigé** |
| 2                                          | Verrouillage de compte à distance sur le login                               | **Élevée** | `app/api/auth/login/route.ts`                   | **Corrigé** |
| 3                                          | Export RGPD sans plafond ni journal d'audit                                  | Moyenne    | `app/api/customers/[id]/export/route.ts`        | **Corrigé** |
| 4                                          | Routes mutantes authentifiées sans plafond (dont bcrypt)                     | Moyenne    | `app/api/employees/route.ts` + 6 autres         | **Corrigé** |
| 5                                          | PII de tous les clients visible par tous les rôles                           | Moyenne    | `app/dashboard/clients/page.tsx`                | À arbitrer  |
| 6                                          | Unicité globale de l'email staff → énumération inter-tenant                  | Moyenne    | `db/schema.sql`, `app/api/auth/signup/route.ts` | À arbitrer  |
| 7                                          | Web service Apple Wallet sans plafond, liste de serials non authentifiée     | Moyenne    | `app/api/wallet/apple/web/[...path]/route.ts`   | Partiel     |
| 8                                          | Confiance aveugle dans `x-real-ip` / `x-forwarded-for`                       | Moyenne    | `lib/security.ts`                               | À arbitrer  |
| 9                                          | `/api/enroll` reste un oracle « cet email est-il client ? »                  | Faible     | `app/api/enroll/route.ts`                       | À arbitrer  |
| 10                                         | `/api/health` expose l'état de configuration interne                         | Faible     | `app/api/health/route.ts`                       | À arbitrer  |
| 11                                         | Validation des données de marque uniquement à l'écriture                     | Faible     | `app/j/[slug]/page.tsx`, `db/schema.sql`        | **Corrigé** |
| 12                                         | `POST /api/card/status` sans contrôle d'origine                              | Faible     | `app/api/card/status/route.ts`                  | **Corrigé** |
| 13                                         | `transactionId` non validé → 500 au lieu de 400                              | Faible     | `app/api/transactions/reverse/route.ts`         | **Corrigé** |
| 14                                         | `AUTH_SECRET` réutilisé pour le JWT et le HMAC Apple                         | Faible     | `lib/apple-wallet.ts`                           | À arbitrer  |
| 15                                         | Cookie de session sans préfixe `__Host-`                                     | Faible     | `lib/auth.ts`                                   | À arbitrer  |
| 16                                         | bcrypt tronque à 72 octets, `bcryptjs` 2.4.3 non maintenu                    | Faible     | `package.json`, routes auth                     | À arbitrer  |
| 17                                         | Fallback DB local + TLS non imposé                                           | Faible     | `lib/db.ts`                                     | À arbitrer  |
| 18                                         | `.gitignore` ne couvre pas tous les fichiers `.env`                          | Faible     | `.gitignore`                                    | **Corrigé** |
| 19                                         | CSP permissive sur `img-src` / `style-src`, actions CI non épinglées         | Faible     | `middleware.ts`, `.github/workflows/`           | À arbitrer  |
| 20                                         | Mot de passe passé en argument de ligne de commande                          | Faible     | `scripts/create-staff.mjs`                      | À arbitrer  |
| 21                                         | Vulnérabilités npm                                                           | Info       | `package-lock.json`                             | Suivi       |

---

## 1. Rétention jamais exécutée + `rate_limits` alimentée par des clés arbitraires — **Élevée**

### Impact

Deux problèmes qui se renforcent l'un l'autre.

**a) Rien ne déclenche la purge.** `purgeStaleRateLimits()` (`lib/rate-limit.ts:37`) n'est appelée nulle part dans le dépôt. `scripts/purge-data-lifecycle.mjs` (`npm run data:purge`) est complet et correct, mais `vercel.json` ne contient aucune clé `crons` et aucun workflow GitHub ne l'invoque. En pratique : `rate_limits`, `product_events`, `audit_logs`, `card_recovery_tokens` et les `apple_wallet_registrations` révoqués grossissent indéfiniment. Les durées de conservation annoncées dans `docs/RGPD.md` ne sont donc pas appliquées — c'est un écart de conformité (RGPD art. 5.1.e), pas seulement une dette technique.

**b) Trois routes non authentifiées laissent le client choisir la clé primaire insérée.** `consumeRateLimit` fait un `insert ... on conflict (key_hash)`. Quand la clé dérive d'une valeur arbitraire fournie par l'appelant, chaque requête écrit une **nouvelle ligne** :

| Route Clé Valeur contrôlée par l'attaquant  |                                 |                                                              |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `POST /api/card/status`                     | `card-status:${token}`          | le token, jamais vérifié avant                               |
| `POST /api/enroll`                          | `enroll:${ip}:${slug}`          | le slug, consommé **avant** le `select` sur `establishments` |
| `POST /api/events`                          | `event-join-view:${ip}:${slug}` | idem                                                         |

Conséquences : écriture illimitée en base par un anonyme (saturation disque, contention sur l'index, coût), et surtout **le plafond ne freine rien** sur ces buckets — chaque tentative repart d'un compteur neuf, donc l'énumération de tokens ou de slugs est libre malgré le rate limit affiché.

### Correctif

**(i) Coupler systématiquement un bucket par IP aux buckets à clé variable.**

`app/api/card/status/route.ts` :

```ts
// AVANT
const limited = await enforceRateLimit(request, `card-status:${token}`, 125, 6 * 60);
if (limited) return limited;

// APRÈS — le bucket par IP est à espace de clés borné et ne peut pas être contourné
const perIp = await enforceRateLimit(request, "card-status-ip", 400, 6 * 60);
if (perIp) return perIp;
const limited = await enforceRateLimit(request, `card-status:${token}`, 125, 6 * 60);
if (limited) return limited;

```

**(ii) Valider l'existence de l'établissement avant de consommer un bucket dérivé du slug.**

`app/api/enroll/route.ts` — déplacer le `select` sur `establishments` **au-dessus** du `consumeRateLimit`, et garder un plafond par IP seule en première ligne :

```ts
// 1. plafond par IP, espace de clés borné
const byIp = await consumeRateLimit(`enroll-ip:${requestIp(req)}`, 60, 60 * 60);
if (!byIp.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });

// 2. l'établissement doit exister avant de créer un bucket à son nom
const [establishment] = await sql`
  select e.id, e.status, p.expires_after_days
  from establishments e
  join loyalty_programs p on p.establishment_id = e.id
  where e.slug = ${slug} and p.active = true
  limit 1
`;
if (!establishment || establishment.status !== "active") {
  return Response.json({ error: "ESTABLISHMENT_NOT_FOUND" }, { status: 404 });
}

// 3. seulement maintenant, le bucket fin
const rate = await consumeRateLimit(`enroll:${requestIp(req)}:${establishment.id}`, 15, 60 * 60);
if (!rate.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });

```

Appliquer la même inversion dans `app/api/events/route.ts` pour `JOIN_PAGE_VIEW` (résoudre l'établissement d'abord, puis `event-join-view:${ip}:${establishment.id}`).

**(iii) Planifier la purge.** Ajouter une route cron protégée par secret :

```ts
// app/api/cron/purge/route.ts
import { purgeStaleRateLimits } from "@/lib/rate-limit";
import { withApiErrorHandling } from "@/lib/observability";
import { timingSafeEqual } from "node:crypto";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleGet(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 });
  const rateLimits = await purgeStaleRateLimits(48);
  return Response.json({ ok: true, rateLimits }, { headers: { "cache-control": "no-store" } });
}

export const GET = withApiErrorHandling("CRON_PURGE", handleGet);

```

```jsonc
// vercel.json
{
  "regions": ["fra1"],
  "crons": [{ "path": "/api/cron/purge", "schedule": "23 3 * * *" }]
}

```

Et pour la rétention complète (product_events, audit_logs, tokens, registrations Apple), un workflow planifié qui exécute le script existant :

```yaml
# .github/workflows/data-lifecycle.yml
name: data-lifecycle
on:
  schedule:
    - cron: "41 2 * * *"
  workflow_dispatch:
permissions:
  contents: read
jobs:
  purge:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm }
      - run: npm ci --no-audit --no-fund
      - run: npm run data:purge -- --execute
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

```

> Le script prend déjà un `pg_try_advisory_lock` et travaille par lots de 5 000 : deux exécutions concurrentes sont sans danger.

---

## 2. Verrouillage de compte à distance sur le login — **Élevée**

### Impact

`app/api/auth/login/route.ts` maintient un second compteur par compte pour contrer le brute-force distribué — bonne idée — mais il est consommé à **chaque** tentative, y compris celles qui réussissent, et n'est jamais remis à zéro :

```ts
const byAccount = await consumeRateLimit(`login-account:${email}`, 20, 15 * 60);
if (!byAccount.allowed) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

```

Vingt requêtes suffisent donc pour **empêcher un commerçant de se connecter pendant 15 minutes**, en ne connaissant que son adresse email. Répété en boucle, c'est un déni de service permanent sur un compte ciblé — en pleine heure de service, la caisse est bloquée. L'attaquant n'a besoin d'aucun mot de passe et le coût est nul.

Le même email étant unique globalement (§6), il est aussi trivial de découvrir des cibles.

### Correctif appliqué

Une première version de ce correctif se contentait de consulter le compteur sans le consommer avant la vérification du mot de passe. C'était insuffisant : au bout de 20 échecs, le titulaire restait bloqué. **Le compteur doit gouverner les échecs, pas l'accès.**

Deux helpers ajoutés dans `lib/rate-limit.ts` :

```ts
/** Remet un compteur a zero apres une operation legitime reussie. */
export async function resetRateLimit(rawKey: string): Promise<void> {
  await sql`delete from rate_limits where key_hash = ${hashRateKey(rawKey)}`;
}

```

Et la route ne consulte plus le compteur en amont — elle vérifie d'abord le mot de passe :

```ts
const passwordOk = await bcrypt.compare(password, hash);
if (!user || !user.active || !passwordOk) {
  // Seul l'echec consomme un jeton.
  const { allowed } = await consumeRateLimit(accountKey, ACCOUNT_ATTEMPT_LIMIT, ACCOUNT_WINDOW_SECONDS);
  if (!allowed) {
    console.warn("LOGIN_ACCOUNT_THROTTLED", { account: hashRateKey(email).slice(0, 12) });
    return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  }
  return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
}

// Un mot de passe correct n'est jamais rejete, et remet le compteur a zero.
await resetRateLimit(accountKey);

```

### Compromis assumé

Ce correctif n'est pas gratuit et il faut le dire clairement.

**Ce qu'on perd** : le plafond dur de 20 tentatives / 15 min / compte, tous IP confondues. Un attaquant distribué retombe sur la limite par IP (10 / 15 min) et peut donc, avec assez d'adresses, dépasser l'ancien plafond global.

**Ce qu'on gagne** : la disparition d'un déni de service trivial, à coût nul, contre un compte nommé — sur un logiciel de caisse utilisé en plein service. Un commerçant bloqué 15 minutes pendant le coup de feu est un dégât opérationnel immédiat et certain ; le brute-force distribué contre un hash bcrypt coût 12 reste un scénario coûteux et lent.

**Contreparties mises en place** : la limite par IP reste consommée à chaque tentative, et le franchissement du seuil par compte émet `LOGIN_ACCOUNT_THROTTLED` (adresse hachée, jamais en clair) — un signal exploitable dans les logs Vercel pour détecter l'acharnement, ce que l'ancien blocage silencieux ne donnait pas.

Si vous préférez l'arbitrage inverse — priorité absolue au brute-force, DoS ciblé accepté — il suffit de rétablir la consultation en amont. C'est une décision produit, pas technique.

## 3. Export RGPD sans plafond ni journal d'audit — Moyenne

### Impact

`GET /api/customers/[id]/export` renvoie l'intégralité du dossier d'un client : email, téléphone, prénom, consentement marketing, ledger complet, passes wallet, demandes de récupération, télémétrie produit et piste d'audit. La route n'a **ni rate limit ni écriture dans** **`audit_logs`**, alors que l'effacement (`CUSTOMER_ERASE`) et l'ajustement (`CARD_ADJUSTED`) sont tous deux journalisés.

Un compte OWNER ou MANAGER compromis peut donc aspirer la base clients entière, enregistrement par enregistrement, sans laisser la moindre trace exploitable en réponse à incident. C'est exactement le scénario que la piste d'audit est censée couvrir.

### Correctif

```ts
// app/api/customers/[id]/export/route.ts
import { enforceRateLimit } from "@/lib/rate-limit";

async function handleGet(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!canManageProgram(session.role)) return Response.json({ error: "FORBIDDEN" }, { status: 403 });

  // Un export RGPD est unitaire et rare. 20/h couvre tout usage légitime et
  // rend l'aspiration de la base bruyante et lente.
  const limited = await enforceRateLimit(req, `customer-export:${session.staffId}`, 20, 60 * 60);
  if (limited) return limited;

  const { id } = await params;
  // ... requêtes inchangées ...
  if (!customer) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Toute lecture massive de PII doit être traçable a posteriori.
  await sql`
    insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
    values(${session.establishmentId}, ${session.staffId}, 'CUSTOMER_EXPORT', 'customer', ${id},
           ${sql.json({ transactions: transactions.length })})
  `;

  // ... réponse inchangée ...
}

```

Prévoir une alerte d'exploitation si plus de N `CUSTOMER_EXPORT` sont émis par le même `staff_user_id` en 24 h.

---

## 4. Routes mutantes authentifiées sans plafond — Moyenne

### Impact

Sept routes n'ont aucun `enforceRateLimit`. La plus coûteuse est `POST /api/employees` : chaque appel exécute `bcrypt.hash(password, 12)`, soit \~250-400 ms de CPU serveur. Un compte MANAGER légitime ou compromis peut saturer le runtime avec quelques dizaines de requêtes parallèles — déni de service à coût quasi nul pour l'attaquant, et la fonction serverless est facturée pendant ce temps.

Les autres sont moins critiques mais permettent le même genre d'abus (bruit dans le ledger, martelage de la base) :

| Route Risque                                  |                                          |
| --------------------------------------------- | ---------------------------------------- |
| `POST /api/employees`                         | bcrypt(12) illimité → épuisement CPU     |
| `POST /api/transactions/reverse`              | écritures ledger en rafale               |
| `DELETE /api/customers/[id]`                  | effacements en masse, transaction lourde |
| `PATCH /api/restaurant`, `PATCH /api/program` | martelage écriture + audit               |
| `GET /api/history`, `GET /api/dashboard`      | agrégats coûteux non plafonnés           |

### Correctif

Ajouter une garde par `staffId` en tête de chaque handler, avec des plafonds calibrés sur l'usage réel :

```ts
// app/api/employees/route.ts — handlePost
const limited = await enforceRateLimit(req, `employee-create:${session.staffId}`, 10, 60 * 60);
if (limited) return limited;

// app/api/transactions/reverse/route.ts
const limited = await enforceRateLimit(req, `reverse:${session.staffId}`, 60, 60);
if (limited) return limited;

// app/api/customers/[id]/route.ts — handleDelete
const limited = await enforceRateLimit(req, `customer-erase:${session.staffId}`, 20, 60 * 60);
if (limited) return limited;

// app/api/restaurant/route.ts — handlePatch
const limited = await enforceRateLimit(req, `restaurant-patch:${session.staffId}`, 30, 60 * 60);
if (limited) return limited;

// app/api/program/route.ts — handlePatch
const limited = await enforceRateLimit(req, `program-patch:${session.staffId}`, 30, 60 * 60);
if (limited) return limited;

// app/api/history/route.ts et app/api/dashboard/route.ts
const limited = await enforceRateLimit(req, `history:${session.staffId}`, 120, 60);
if (limited) return limited;

```

`handleGet` de `/api/employees` et `/api/dashboard` ne reçoivent pas la `Request` aujourd'hui — il faut changer la signature en `async function handleGet(req: Request)`, `withApiErrorHandling` la transmet déjà.

---

## 5. PII de tous les clients visible par tous les rôles — Moyenne

### Impact

`app/dashboard/clients/page.tsx` vérifie seulement `if (!session) redirect("/login")`. Le rôle n'est utilisé que pour activer les **actions** (`canManage={canManageProgram(session.role)}`). La liste elle-même — prénom, **email**, **téléphone**, consentement marketing, solde — est rendue pour n'importe quelle session valide, donc y compris un rôle `EMPLOYEE` (poste de caisse partagé) ou `VIEWER`.

Or le modèle de rôles existe précisément pour ça : un employé de caisse a besoin de scanner et de créditer, pas de la liste des coordonnées de tous les clients du commerce. C'est un manquement à la minimisation (RGPD art. 5.1.c) et le poste caisse est le terminal le plus exposé (partagé, souvent laissé déverrouillé).

Même remarque, plus légère, pour `/dashboard/transactions` (emails du personnel exposés à tous les rôles) et pour `GET /api/program` / `GET /api/restaurant` (pas de contrôle de rôle en lecture).

### Correctif

Masquer les coordonnées côté serveur quand le rôle n'a pas le droit de les voir — le masquage doit avoir lieu **avant** la sérialisation vers le client, pas dans le composant React :

```tsx
// app/dashboard/clients/page.tsx
const canSeeContact = canManageProgram(session.role);

const customers: Customer[] = rows.map(row => ({
  id: String(row.id),
  first_name: row.first_name ? String(row.first_name) : null,
  // Les coordonnées ne quittent le serveur que pour les rôles habilités.
  email: canSeeContact && row.email ? String(row.email) : null,
  phone: canSeeContact && row.phone ? String(row.phone) : null,
  marketing_consent: Boolean(row.marketing_consent),
  created_at: String(row.created_at),
  short_code: row.short_code ? String(row.short_code) : null,
  balance: row.balance == null ? null : Number(row.balance),
  active: row.active == null ? null : Boolean(row.active),
}));

```

Et restreindre la recherche par email pour les rôles non habilités (sinon la recherche redevient un oracle) :

```tsx
const rows = term
  ? await sql`
      select u.id, u.first_name, u.email, u.phone, u.marketing_consent, u.created_at,
             c.short_code, c.balance, c.active
      from customers u
      left join cards c on c.customer_id = u.id
      where u.establishment_id = ${session.establishmentId}
        and u.deleted_at is null
        and (
          lower(coalesce(c.short_code,'')) = lower(${term})
          or (${canSeeContact}::boolean and (
                lower(coalesce(u.first_name,'')) like ${'%' + term.toLowerCase() + '%'}
             or lower(coalesce(u.email,''))      like ${'%' + term.toLowerCase() + '%'}
          ))
        )
      order by u.created_at desc limit 100
    `
  : /* ... */;

```

> Note annexe : `term` est bien passé en paramètre (pas d'injection SQL), mais `%` et `_` saisis par l'utilisateur restent interprétés comme des jokers `LIKE`. Sans conséquence de sécurité ici, puisque le rôle habilité peut déjà tout lister.

Ajouter également un `if (!canManageProgram(session.role)) redirect("/dashboard")` sur `/dashboard/clients` si le métier n'a pas besoin que la caisse consulte la liste du tout — c'est la solution la plus simple et la plus sûre.

---

## 6. Unicité globale de l'email staff → énumération inter-tenant — Moyenne

### Impact

```sql
create unique index if not exists staff_users_email_key on staff_users (lower(email));

```

L'index est global, sans `establishment_id`. Trois conséquences :

1. **Énumération de comptes sur une route non authentifiée.** `POST /api/auth/signup` renvoie `409 EMAIL_EXISTS` dès que l'adresse existe chez **n'importe quel** commerce de la plateforme. Le login, lui, a été soigneusement protégé contre l'énumération (hash factice, temps de réponse constant) — cette protection est annulée par le signup, qui donne la même information gratuitement. Idem sur `POST /api/employees` avec `409 EMAIL_ALREADY_USED`.
2. **Blocage fonctionnel.** Un gérant de deux commerces ne peut pas utiliser la même adresse pour les deux. Un salarié qui change d'employeur non plus.
3. **Squat d'adresse.** N'importe qui peut créer un compte avec l'adresse d'un concurrent pour l'empêcher de s'inscrire.

### Correctif

**(i) Rendre l'unicité locale au tenant.** Migration :

```sql
-- db/migrations/014_staff_email_per_tenant.sql
begin;

-- Détecter les collisions avant de relâcher la contrainte globale.
do $$
declare duplicated int;
begin
  select count(*) into duplicated from (
    select lower(email) from staff_users group by lower(email) having count(*) > 1
  ) as collisions;
  if duplicated > 0 then
    raise notice 'Adresses déjà présentes plusieurs fois : %', duplicated;
  end if;
end $$;

drop index if exists staff_users_email_key;
create unique index if not exists staff_users_estab_email_key
  on staff_users (establishment_id, lower(email));

commit;

```

Mettre à jour `db/schema.sql` en conséquence, et adapter la détection de conflit dans `signup` (la contrainte violée s'appelle désormais `staff_users_estab_email_key`).

**(ii) Ne plus confirmer l'existence d'un compte au signup.** Réponse identique dans les deux cas, l'information partant par email :

```ts
// app/api/auth/signup/route.ts — bloc catch
if (String(error).includes("staff_users_estab_email_key")) {
  // Réponse volontairement indistinguable d'un succès : c'est l'email qui
  // tranche, pas le code HTTP. Sinon la route devient un oracle de comptes.
  return NextResponse.json({ ok: true, pending: true }, { status: 202 });
}

```

Si le changement de contrat d'API est trop coûteux à court terme, le repli minimal est de durcir le plafond du signup (aujourd'hui 5/h/IP) et d'ajouter un délai constant, en acceptant que l'oracle subsiste.

**(iii)** `POST /api/employees` reste interne au tenant après la migration : son `409` ne fuite plus rien sur les autres commerces, il peut rester tel quel.

---

## 7. Web service Apple Wallet sans plafond, liste de serials non authentifiée — Moyenne

### Impact

`app/api/wallet/apple/web/[...path]/route.ts` est la seule famille de routes sans aucun `enforceRateLimit`. Les trois verbes interrogent la base **avant** toute authentification (`authorizedWalletPass` fait un `select` puis compare le hash), donc un anonyme peut générer autant de requêtes SQL qu'il veut à coût nul.

Deux points supplémentaires :

- `POST /v1/log` est imposé non authentifiable par Apple et accepte un corps JSON arbitraire. Le code ne journalise que le nombre d'entrées — bien vu — mais le corps est quand même parsé sans borne de taille.
- `GET /v1/devices/{device}/registrations/{passType}` **ne vérifie aucun token**. Qui devine ou observe un `device_library_identifier` obtient la liste des `serialNumbers`, c'est-à-dire les UUID internes de cartes. La spécification Apple tolère cette route sans authentification, mais rien n'oblige à s'en tenir au minimum.

### Correctif

```ts
// app/api/wallet/apple/web/[...path]/route.ts
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request, context: Context) {
  // Ces routes touchent la base avant toute authentification : plafond par IP
  // en première ligne, sinon c'est un DoS SQL gratuit pour un anonyme.
  const limited = await enforceRateLimit(request, "wallet-apple-web", 60, 60);
  if (limited) return limited;
  // ... suite inchangée

  if (path.length === 2 && path[0] === "v1" && path[1] === "log") {
    // Borne explicite : Apple n'envoie que quelques kilo-octets.
    const raw = await request.text();
    if (raw.length > 32_000) return new Response(null, { status: 413 });
    let count = 0;
    try {
      const body = JSON.parse(raw) as { logs?: unknown };
      count = Array.isArray(body.logs) ? body.logs.length : 0;
    } catch { /* corps illisible : on l'ignore silencieusement */ }
    console.warn(`Apple Wallet device log received (${count} entries)`);
    return new Response(null, { status: 200 });
  }
  // ...
}

```

Répliquer les deux premières lignes dans `DELETE` et `GET`. Pour la liste de serials, exiger le même en-tête `ApplePass` que les autres routes — Apple l'envoie :

```ts
if (path.length === 5 && path[0] === "v1" && path[1] === "devices" && path[3] === "registrations") {
  const device = path[2];
  const passType = path[4];
  if (passType !== applePassTypeIdentifier()) return new Response(null, { status: 404 });

  // Ne pas livrer la liste des serials à qui devine un device identifier.
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("ApplePass ")) return new Response(null, { status: 401 });
  const supplied = createHash("sha256")
    .update(authorization.slice("ApplePass ".length).trim())
    .digest("hex");
  const [owner] = await sql`
    select 1 from apple_wallet_registrations r
    join wallet_passes wp on wp.id = r.wallet_pass_id
    where r.device_library_identifier = ${device}
      and wp.provider = 'APPLE'
      and wp.external_id = ${passType}
      and wp.authentication_token_hash = ${supplied}
    limit 1
  `;
  if (!owner) return new Response(null, { status: 401 });
  // ... requêtes existantes inchangées
}

```

> À valider sur un appareil réel avant mise en production : si un iPhone interroge cette route sans en-tête `Authorization`, revenir à un simple plafond par IP plutôt que casser la synchronisation des passes.

---

## 8. Confiance aveugle dans `x-real-ip` / `x-forwarded-for` — Moyenne

### Impact

`lib/security.ts` prend `x-real-ip` en priorité, sinon l'élément **le plus à droite** de `x-forwarded-for`. Le commentaire explique très bien pourquoi l'index 0 était faux. Mais les deux en-têtes restent de simples en-têtes HTTP : la sécurité dépend entièrement du fait qu'un proxy de confiance les **réécrive** systématiquement.

Ce n'est vrai que derrière l'edge Vercel. Dès que l'application tourne autrement — `next start` derrière un reverse proxy mal configuré, exécution directe, environnement de preview, futur self-hosting — un client pose lui-même `X-Real-IP: <aléatoire>` et obtient un bucket neuf à chaque requête. **Tous** les plafonds par IP tombent simultanément : login (§2), enroll, recovery, client-errors, card-public, wallet. Et chaque valeur inédite crée une ligne de plus dans `rate_limits` (§1).

### Correctif

Rendre l'hypothèse explicite et vérifiable, plutôt qu'implicite :

```ts
// lib/security.ts

/**
 * Résolution de l'IP client.
 *
 * Aucun en-tête `x-*` n'est digne de confiance en soi : il ne l'est que si un
 * proxy de bord le réécrit systématiquement. On privilégie donc l'en-tête que
 * la plateforme garantit (Vercel), et on n'accepte les en-têtes génériques que
 * lorsque le déploiement a explicitement déclaré tourner derrière un proxy.
 */
export function requestIp(req: Request): string {
  // Posé par l'edge Vercel et non surchargeable par le client.
  const vercel = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel.split(",")[0].trim();

  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const realIp = req.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
    const chain = req.headers.get("x-forwarded-for");
    if (chain) {
      const parts = chain.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }

  return "unknown";
}

```

Conséquence voulue : hors proxy de confiance, tout le trafic tombe dans le bucket `unknown`, c'est-à-dire **un plafond global partagé**. C'est volontairement dégradé mais fail-closed : mieux vaut limiter trop que ne pas limiter du tout. Ajouter `TRUST_PROXY_HEADERS` à `scripts/validate-env.mjs` avec le même contrôle `true`/`false` que les autres flags.

---

## 9. `/api/enroll` reste un oracle « cet email est-il client ? » — Faible

### Impact

Le commentaire en tête d'`existingCustomerId` explique justement vouloir éviter l'oracle RGPD… mais la route renvoie toujours `409 CARD_ALREADY_EXISTS` quand l'adresse existe, contre `201` sinon. Depuis la page publique `/j/{slug}`, sans aucune authentification, on distingue donc les clients d'un commerce donné. Le plafond (15/h par IP et par slug) ralentit sans supprimer : une liste d'adresses se teste sur plusieurs jours ou plusieurs IP.

Pour un salon de coiffure, un bar ou une clinique, « cette personne est cliente ici » est une donnée en soi.

### Correctif

Aligner sur le modèle déjà appliqué — et bien appliqué — dans `/api/recovery/request` : réponse générique identique dans tous les cas, l'information partant par email.

```ts
const GENERIC_ENROLL_RESPONSE = {
  ok: true,
  message: "Si cette adresse n'a pas encore de carte, elle vient d'être créée. Vérifie tes emails.",
};

// ... après validation ...
if (await existingCustomerId(establishment.id, email, phone)) {
  // Même réponse que pour une création : le visiteur légitime reçoit un email
  // lui rappelant sa carte existante, un tiers n'apprend rien.
  after(() => sendExistingCardReminder(String(establishment.id), email));
  return Response.json(GENERIC_ENROLL_RESPONSE, { status: 202, headers: PRIVATE_HEADERS });
}

```

Le formulaire (`components/join-form.tsx`) doit alors afficher le message générique et inviter à consulter la boîte mail, au lieu d'attendre le token en réponse. C'est un changement de parcours produit : à arbitrer, mais c'est le seul moyen de fermer l'oracle.

---

## 10. `/api/health` expose l'état de configuration interne — Faible

### Impact

La route est publique et non plafonnée. Elle révèle si la base est joignable, si le schéma est à jour, si `AUTH_SECRET` est posé, et si Apple Wallet / Google Wallet / HTTPS sont configurés. Pour un attaquant c'est une carte de reconnaissance gratuite : un `schema: "down"` signale une fenêtre de migration, un `auth: "down"` un déploiement incomplet.

### Correctif

Payload minimal en public, détail derrière le même secret que le cron :

```ts
export async function GET(request: Request) {
  const detailed = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    === process.env.CRON_SECRET?.trim();
  // ... calcul inchangé ...

  const body = detailed
    ? { ok: schemaReady, service: "retiko", database: "up", schema: schemaReady ? "up" : "down",
        auth: "up", wallet: walletState, serverMs: Date.now() - started }
    : { ok: schemaReady };   // surface publique réduite au strict minimum

  return Response.json(body, {
    status: schemaReady ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}

```

Adapter `.github/workflows/production-smoke.yml` pour envoyer l'en-tête (`secrets.CRON_SECRET`) : c'est ce workflow qui consomme les champs détaillés.

---

## 11. Validation des données de marque uniquement à l'écriture — Faible

### Impact

`safeHttpsUrl` (ajouté dans `PATCH /api/restaurant`) et `normalizeHexColor` corrigent le chemin d'**écriture**. Mais :

- `app/j/[slug]/page.tsx` rend `<img src={restaurant.logo_url}>` sans validation et interpole `primary_color` **brut** dans une chaîne CSS : ``style={{background:`linear-gradient(160deg, ${restaurant.primary_color}18, #f5f6f8 55%)`}}``. La page `/c/[token]`, elle, passe bien par `normalizeHexColor`.
- `db/schema.sql` ne pose **aucune contrainte** **`check`** sur `primary_color` (contrairement à `status`, `mode`, `role`…).
- Aucune migration de nettoyage n'a été passée sur les lignes créées **avant** l'ajout de `safeHttpsUrl`. Une URL `javascript:` ou `data:` enregistrée à l'époque est toujours servie aujourd'hui.

L'exploitation reste difficile (React échappe, `javascript:` n'exécute rien dans `<img src>`, un objet `style` React n'autorise pas l'injection de propriété), mais la défense repose sur une seule couche et sur l'hypothèse que toutes les lignes ont été écrites après le durcissement.

### Correctif

**(i) Normaliser à la lecture**, comme le fait déjà `/c/[token]` :

```tsx
// app/j/[slug]/page.tsx
import { normalizeHexColor } from "@/lib/brand-color";

const brandColor = normalizeHexColor(restaurant.primary_color, "#111111");
const logoUrl = typeof restaurant.logo_url === "string"
  && /^https:\/\//i.test(restaurant.logo_url) ? restaurant.logo_url : null;

return <main className="auth-wrap" style={{ background: `linear-gradient(160deg, ${brandColor}18, #f5f6f8 55%)` }}>
  <section className="card auth-card">
    {logoUrl && <img src={logoUrl} alt="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 14 }} />}
    {/* ... */}

```

**(ii) Verrouiller au niveau base et nettoyer l'historique :**

```sql
-- db/migrations/015_brand_hardening.sql
begin;

update establishments
set primary_color = '#111111'
where primary_color !~ '^#[0-9a-fA-F]{6}$';

alter table establishments
  add constraint establishments_primary_color_check
  check (primary_color ~ '^#[0-9a-fA-F]{6}$');

-- Les URL écrites avant l'ajout de safeHttpsUrl n'ont jamais été nettoyées.
update establishments set logo_url = null where logo_url is not null and logo_url !~* '^https://';
update establishments set website  = null where website  is not null and website  !~* '^https://';

commit;

```

---

## 12. `POST /api/card/status` sans contrôle d'origine — Faible

`app/api/card/status/route.ts` est la seule route `POST` sans `rejectCrossOrigin`. N'importe quel site tiers peut donc y poster et sonder le solde d'une carte dont il connaît le token (par exemple un token vu sur un écran de caisse ou récupéré dans un historique de navigation partagé). La lecture est bénigne mais la protection est gratuite et cohérente avec le reste du code :

```ts
import { rejectCrossOrigin } from "@/lib/security";

async function handlePost(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  // ... suite inchangée
}

```

À vérifier : la page carte est same-origin, le polling toutes les 3 s n'est donc pas impacté.

---

## 13. `transactionId` non validé — Faible

`app/api/transactions/reverse/route.ts` injecte `String(transactionId)` dans une comparaison sur une colonne `uuid`. Une valeur non-UUID déclenche une erreur Postgres `22P02` remontée en `500` par `withApiErrorHandling`, au lieu du `400` attendu — et pollue les logs d'erreur, ce qui dégrade la détection d'incidents réels.

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const { transactionId, idempotencyKey } = await req.json().catch(() => ({}));
if (typeof transactionId !== "string" || !UUID.test(transactionId) || !isValidIdempotencyKey(idempotencyKey)) {
  return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
}

```

Noter aussi le `await req.json()` sans `.catch()` : un corps non-JSON produit également un `500`. Même remarque dans `app/api/scan/route.ts`, `app/api/redeem/route.ts` et `app/api/employees/route.ts`.

---

## 14. `AUTH_SECRET` réutilisé pour le JWT et le HMAC Apple — Faible

`lib/apple-wallet.ts` dérive le token d'authentification des passes avec `createHmac("sha256", process.env.AUTH_SECRET)`, la même clé que celle qui signe les sessions JWT (`lib/auth.ts`). Pas de faille exploitable en l'état — les domaines de préfixe sont disjoints (`fidgo:apple:…`) — mais toute rotation d'`AUTH_SECRET` invalide simultanément **toutes les sessions et tous les passes Apple déjà émis**, ce qui rend la rotation quasi impossible en pratique. C'est un problème opérationnel autant que cryptographique.

```ts
// lib/keys.ts
import { hkdfSync } from "node:crypto";

export function derivedKey(purpose: "session" | "apple-pass"): Buffer {
  const master = process.env.AUTH_SECRET;
  if (!master) throw new Error("AUTH_SECRET is required");
  return Buffer.from(hkdfSync("sha256", master, "retiko-v1", purpose, 32));
}

```

Puis `createHmac("sha256", derivedKey("apple-pass"))`. Migration à prévoir : les passes déjà émis conservent l'ancien token, il faut accepter les deux pendant une période de transition (comparer contre les deux hash) ou forcer une réémission.

---

## 15. Cookie de session sans préfixe `__Host-` — Faible

`lib/auth.ts` pose `loyalty_staff` avec `httpOnly`, `secure` en production, `sameSite: "lax"`, `path: "/"`. C'est correct. Deux durcissements peu coûteux :

```ts
// Le préfixe __Host- est imposé par le navigateur : cookie obligatoirement
// Secure, Path=/, sans Domain. Un sous-domaine compromis ne peut plus l'écraser.
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-loyalty_staff" : "loyalty_staff";

export function sessionCookie(value: string) {
  return {
    name: COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Toutes les routes mutantes passent par fetch same-origin : "strict" ne
    // casse rien et supprime la classe entière des attaques CSRF par navigation.
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60 * 12,
  };
}

```

`sameSite: "strict"` est à tester sur le parcours de retour Stripe Checkout (`/dashboard/billing?checkout=success`) : la redirection depuis `checkout.stripe.com` est une navigation top-level cross-site, la session ne sera pas envoyée sur la première requête et l'utilisateur atterrira sur `/login`. Si c'est bloquant, rester en `lax` — l'`Origin` check couvre déjà l'essentiel — ou ajouter une page relais same-origin.

---

## 16. bcrypt : troncature à 72 octets, `bcryptjs` non maintenu — Faible

`bcryptjs@2.4.3` date de 2017. Indépendamment de la version, **bcrypt ignore silencieusement tout ce qui dépasse 72 octets** : un mot de passe de 200 caractères n'offre pas plus d'entropie que ses 72 premiers, alors que `/api/auth/login` en accepte 256 et laisse croire le contraire. Avec des caractères accentués (2-3 octets chacun), la limite tombe à \~24 caractères visibles.

```ts
// lib/password.ts
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * bcrypt tronque à 72 octets. Un pré-hachage SHA-256 en base64 ramène toute
 * entrée à 44 octets : la longueur du mot de passe compte enfin réellement.
 */
function prepare(password: string) {
  return createHash("sha256").update(password, "utf8").digest("base64");
}

export function hashPassword(password: string) {
  return bcrypt.hash(prepare(password), 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(prepare(password), hash);
}

```

Attention : ce changement invalide les hash existants. Deux options — vérifier d'abord avec la nouvelle méthode puis retomber sur `bcrypt.compare(password, hash)` et ré-hacher à la volée en cas de succès, ou imposer une réinitialisation. Passer aussi `bcryptjs` en `3.x` (maintenu) ou migrer vers `argon2id`, et appliquer une politique de mot de passe plus exigeante que « ≥ 8 caractères » (aujourd'hui `azertyui` passe).

---

## 17. Fallback DB local et TLS non imposé — Faible

`lib/db.ts` :

```ts
const fallbackUrl = "postgres://fidgo:fidgo@127.0.0.1:5432/fidgo_unconfigured";
export const sql = postgres(databaseUrl || fallbackUrl, { max: 5, prepare: false, connect_timeout: 2 });

```

L'intention (garder le build possible sans secrets) est légitime, mais : si un Postgres local existe sur la machine, l'application s'y connecte silencieusement avec des identifiants triviaux ; et aucune option `ssl` n'est passée, la confidentialité du transport dépend entièrement de la présence de `?sslmode=require` dans l'URL — que `validate-env.mjs` ne vérifie pas.

```ts
export const sql = postgres(databaseUrl || fallbackUrl, {
  max: 5,
  prepare: false,
  connect_timeout: 2,
  // Ne jamais laisser le transport en clair dépendre d'un paramètre d'URL oublié.
  ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
});

```

Et dans `scripts/validate-env.mjs`, exiger `sslmode=require|verify-full` en production. Seules `login`, `signup` et `health` testent `databaseConfigured` aujourd'hui ; ce garde-fou mériterait d'être appliqué à toutes les routes qui écrivent.

---

## 18. `.gitignore` incomplet — Faible

```
.env
.env.local

```

`.env.production`, `.env.production.local`, `.env.development.local` et `.env.test.local` — tous générés par Next.js et par `vercel env pull` — ne sont pas couverts.

```gitignore
# Tout fichier d'environnement est ignoré, l'exemple public est la seule exception.
.env*
!.env.example

```

Ajouter un scan de secrets au CI (`gitleaks`, `trufflehog`) pour attraper ce qui passerait quand même.

---

## 19. CSP permissive et actions CI non épinglées — Faible

`middleware.ts` est globalement bien construit (nonce par requête, `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`). Trois réserves :

- `img-src 'self' data: https:` autorise **n'importe quel** hôte HTTPS. Comme le logo est une URL choisie par le commerçant, chaque affichage d'une page carte envoie l'IP et le User-Agent du client vers un tiers arbitraire — transfert de données personnelles non prévu au registre RGPD. À terme : héberger les logos (Vercel Blob / S3) et restreindre `img-src` à `'self' data:`.
- `style-src 'unsafe-inline'` est imposé par les nombreux `style={{…}}` inline. C'est le maillon faible de la CSP : à traiter le jour où les styles passeront en CSS Modules.
- `matcher` exclut `/api` : les réponses JSON n'ont pas de CSP. Impact faible (JSON + `nosniff` + `X-Content-Type-Options`), mais poser `default-src 'none'` sur les routes API coûte peu.

Côté CI, `actions/checkout@v5` et `actions/setup-node@v5` sont référencées par tag mutable. Les épingler par SHA supprime un vecteur de compromission de chaîne d'approvisionnement :

```yaml
- uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0

```

Dependabot (`.github/dependabot.yml`) gère déjà `github-actions` en hebdomadaire : les SHA seront maintenus automatiquement.

---

## 20. Mot de passe en argument de ligne de commande — Faible

`scripts/create-staff.mjs` prend le mot de passe en `process.argv[4]`. Il apparaît donc dans l'historique du shell, dans `ps aux` pour tous les utilisateurs de la machine, et dans les logs d'exécution CI/CD. Le script ne valide par ailleurs ni la robustesse du mot de passe ni le rôle créé (défaut `EMPLOYEE` du schéma).

```js
import { createInterface } from "node:readline/promises";

const [, , slug, email] = process.argv;
if (!slug || !email) throw new Error("Usage: node scripts/create-staff.mjs <slug> <email>");

// Lecture interactive : le mot de passe ne transite ni par argv ni par l'historique.
const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question("Mot de passe (>= 12 caractères) : ");
rl.close();
if (password.length < 12) throw new Error("Mot de passe trop court.");

```

---

## 21. Dépendances — Info

`npm audit` sur le lockfile audité :

| Paquet Gravité Avis Portée  |         |                                      |                                |
| --------------------------- | ------- | ------------------------------------ | ------------------------------ |
| `vitest` / `@vitest/mocker` | modérée | GHSA-82fw-gwwq-j7x9 (path traversal) | **devDependencies uniquement** |

Aucune vulnérabilité connue en dépendance de production. Le correctif (`vitest` 5.x) est un saut de version majeur : à planifier, sans urgence, puisque le paquet n'est jamais exécuté en production. Le CI exécute déjà `npm audit --audit-level=high` — ce seuil laisse passer les avis `moderate`, ce qui est un choix défendable mais à assumer explicitement.

---

## Ce qui est déjà solide

À conserver tel quel lors des refactorings :

- **Injection SQL** : aucune concaténation de chaîne dans une requête. Les deux `sql.unsafe` de `lib/wallet-data.ts` utilisent des placeholders `$1` — c'est correct.
- **Isolation multi-tenant** : chaque requête porte `establishment_id = ${session.establishmentId}`, y compris dans les sous-requêtes d'effacement. Les contraintes `*_same_tenant_fk` renforcent l'invariant côté base et `/api/health` vérifie leur présence.
- **Concurrence et idempotence** : `for update of c` puis **re-vérification de la clé d'idempotence après acquisition du verrou** — c'est la bonne solution au double crédit, souvent ratée.
- **Sessions** : JWT relu en base à chaque requête, `token_version` incrémenté au logout et à la désactivation d'un employé. Une révocation est effective immédiatement.
- **CSRF** : fail-closed, `Sec-Fetch-Site` en repli, appliqué sur toutes les routes mutantes sauf `/api/card/status` (§12).
- **Anti-énumération au login** : hash factice et temps de réponse constant. Excellente pratique — d'autant plus dommage que le signup l'annule (§6).
- **Webhook Stripe** : signature vérifiée, anti-rejeu par `stripe_webhook_events` dans la transaction, contrôle croisé `client_reference_id` / metadata / session, refus d'un `priceId` venant du client.
- **Effacement RGPD** : anonymisation avec rotation des identifiants publics, purge des motifs libres dans le ledger, révocation des passes, préservation du ledger comptable. Bien pensé.
- **Journalisation** : `sanitizeAuditText`, `redactSensitivePath`, `safeErrorCode` — aucun token, email ou message d'erreur brut ne part dans les logs.

---

## Ordre d'application suggéré

1. **§2** (verrouillage de compte) — impact direct sur l'exploitation, correctif localisé, aucun changement de contrat.
2. **§1(iii)** (planifier la purge) — une route + deux fichiers de configuration, débloque la conformité rétention.
3. **§3**, **§4** (plafonds et audit sur les routes sensibles) — mécanique, sans risque de régression.
4. **§1(i)(ii)**, **§12**, **§13** (durcissement des routes publiques).
5. **§5**, **§6** (moindre privilège et isolation tenant) — nécessitent une migration et un arbitrage produit.
6. **§7**, **§8** — à tester sur environnement de recette avant production (appareil Apple réel, comportement du proxy).
7. Le reste par ordre de coût croissant.

Après application, relancer la suite E2E existante — `tenant-isolation.spec.ts`, `auth-roles.spec.ts`, `fraud-concurrency.spec.ts` et `data-lifecycle.spec.ts` couvrent déjà une bonne partie des invariants touchés — et ajouter un test par correctif (notamment : une authentification réussie remet à zéro le compteur par compte, un export émet bien une ligne `CUSTOMER_EXPORT`).

---

## Annexe — Contenu du patch `fidgo-securite.patch`

23 fichiers, +472 / −27. Applicable sur `1e8effa` (`git apply --check` vérifié).

**Fichiers créés**

| Fichier Rôle                            |                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `app/api/cron/purge/route.ts`           | Purge planifiée de `rate_limits`, protégée par `CRON_SECRET` en fail-closed   |
| `.github/workflows/data-lifecycle.yml`  | Exécution quotidienne du script de rétention, jamais planifié jusqu'ici       |
| `db/migrations/014_brand_hardening.sql` | Nettoyage des valeurs de marque héritées + 3 contraintes `check` (idempotent) |
| `tests/e2e/security-hardening.spec.ts`  | 4 tests de régression, un par faille corrigée                                 |

**Fichiers modifiés** — `lib/rate-limit.ts` (helper `resetRateLimit`), `app/api/auth/login` (§2), `app/api/card/status` (§1, §12), `app/api/enroll` et `app/api/events` (§1), `app/api/customers/[id]/export` (§3), `app/api/customers/[id]`, `app/api/employees`, `app/api/transactions/reverse` (§4, §13), `app/api/restaurant`, `app/api/program`, `app/api/history`, `app/api/dashboard` (§4), `app/api/wallet/apple/web/[...path]` (§7 partiel), `app/j/[slug]/page.tsx` (§11), `vercel.json`, `.env.example`, `scripts/validate-env.mjs`, `.gitignore` (§18).

**Note sur §7** : seul le plafond par IP a été posé. L'exigence d'un en-tête `ApplePass` sur `GET /v1/devices/{device}/registrations/{passType}` est laissée de côté : elle doit être validée sur un iPhone réel avant production, sous peine de casser la synchronisation des passes.

**Avant de déployer** : poser `CRON_SECRET` (≥ 16 octets) dans Vercel Production et `DATABASE_URL` dans les secrets GitHub, sinon la purge reste inactive — `env:check` émet désormais un avertissement dans ce cas.

# Retiko Agent Hub Remote

Ce dossier permet de piloter l'Agent Hub installé sur la tour WSL à travers
GitHub Issues. Aucun port entrant, tunnel HTTP ou secret n'est publié.

## Principe

1. Une issue GitHub est créée avec un titre commençant par `[retiko-agent]`.
2. Le worker WSL vérifie que l'auteur est exactement `yassineimpe-bit`.
3. Il transmet la tâche au `~/projects/agent-hub/router.py` local.
4. Claude, Codex ou AGY travaillent dans leurs worktrees habituels.
5. Le résultat est publié comme commentaire GitHub puis l'issue est fermée.

Le dépôt Fidgo étant public, la vérification stricte de l'auteur est importante :
une issue créée par un autre compte est ignorée même si son titre utilise le bon
préfixe.

**Cette vérification seule ne suffit pas.** GitHub ne change jamais l'auteur
d'une issue quand quelqu'un d'autre modifie son corps : n'importe quel
collaborateur du dépôt disposant d'un accès en écriture peut éditer une issue
ouverte par le propriétaire sans que `author` ne change. Le worker vérifie
donc aussi, via `editor`/`lastEditedAt` sur l'issue (API GraphQL), qu'elle n'a
jamais été modifiée par quelqu'un d'autre que son auteur — et refuse la tâche
(échec fermé) si cette vérification échoue pour une raison quelconque plutôt
que de faire confiance à un corps non vérifié. **Si le résultat est
refusé/échoué**, ouvre une nouvelle issue plutôt que d'éditer l'ancienne.

**Concurrence.** Ajouter un label "en cours" puis continuer n'est pas
atomique entre deux workers : les deux peuvent lister la même issue comme
non prise avant qu'aucun des deux n'ait posé le label. Avant de traiter une
issue, le worker poste un commentaire marqueur portant un jeton unique, puis
relit tous les commentaires-marqueurs de l'issue et vérifie que le sien a
l'id le plus bas — les ids de commentaires GitHub sont attribués côté
serveur dans une séquence strictement croissante, même sous écriture
concurrente, ce qui donne un ordre total fiable là où l'API labels n'offre
aucune opération atomique de type compare-and-swap. Le perdant abandonne
sans jamais lancer l'agent. Échec fermé si la vérification elle-même échoue
ou renvoie une forme inattendue. En complément, un verrou local
(`flock`, service systemd un seul exemplaire à la fois par configuration
dépôt+routeur) empêche deux instances de tourner sur la même machine avant
même d'atteindre cette vérification côté GitHub ; il est automatiquement
libéré par le système à la sortie du processus, y compris en cas de crash —
aucun nettoyage manuel, aucun blocage permanent possible.

## Format d'une tâche

Titre :

```text
[retiko-agent] audit sécurité
```

Corps :

```text
agent: auto

task:
Analyse la sécurité du dépôt, exécute les tests pertinents et ne merge rien.
```

Valeurs possibles pour `agent` : `auto`, `claude`, `codex`, `agy`,
`team`.

Avec `auto`, le routeur local choisit lui-même l'agent et applique son fallback.

## Tests

Tests unitaires avec mocks (aucun appel `gh` réel, aucun réseau, aucun vrai
secret dans les fixtures) — couvrent la vérification d'intégrité du corps
(`editor`/`lastEditedAt`, y compris les réponses GraphQL incomplètes ou
inattendues), l'anti-boucle sur échec, la redaction, les timeouts, ainsi que
la concurrence (deux workers forcés dans la vraie fenêtre de course via un
`threading.Barrier`, un seul gagne ; verrou local acquis/refusé/libéré à la
fermeture) :

```bash
python3 -m unittest discover -s tools/agent-hub-remote/tests -v
```

Le check GraphQL d'intégrité lui-même reste à valider une fois en conditions
réelles avec `--once` sur une issue effectivement éditée par un autre compte
avant de merger cette PR — les tests ci-dessus vérifient sa logique contre
des réponses simulées, pas le comportement réel de l'API GitHub.

## Installation sur la tour WSL

Le worker suppose que :

- `gh auth status` fonctionne déjà ;
- `~/projects/agent-hub/router.py` fonctionne ;
- les worktrees Claude/Codex/AGY existent.

Depuis le clone Fidgo :

```bash
git fetch origin
git switch agent/remote-hub
chmod +x tools/agent-hub-remote/install-user-service.sh
./tools/agent-hub-remote/install-user-service.sh
```

Vérifier :

```bash
systemctl --user status retiko-agent-worker.service
journalctl --user -u retiko-agent-worker.service -f
```

Test ponctuel sans service :

```bash
python3 tools/agent-hub-remote/remote_worker.py --once
```

## Utilisation depuis ChatGPT

Une fois le worker actif, une conversation ChatGPT connectée à GitHub peut créer
une issue `[retiko-agent] ...` dans `yassineimpe-bit/Fidgo`. La tour la prend
en charge automatiquement. Le résultat revient dans les commentaires de l'issue
et peut ensuite être relu dans le même chat via GitHub.

## Sécurité

Ne jamais committer les fichiers suivants :

- `.env.local`
- tokens GitHub
- clés API
- identifiants Claude/OpenAI/Google
- secrets Neon

Le worker utilise l'authentification existante du CLI `gh` sur la tour. Par
défaut, ça veut dire que le worker hérite du scope complet de ta session
`gh auth login` interactive. Recommandé : crée un token GitHub *fine-grained*
limité à ce dépôt avec uniquement `metadata: read` et `issues: read+write`,
et exporte-le en `GH_TOKEN` (dans le fichier service, ou dans ton shell) —
`gh` le prend automatiquement en priorité sur la session interactive.

**Frontière de confiance.** Ce worker ne sandboxe pas ce que fait l'agent une
fois lancé : le texte de la tâche est un prompt de langage naturel transmis
tel quel à un agent de codage disposant d'un accès fichier/réseau complet sur
la tour (c'est tout l'intérêt de l'outil). Le seul garde-fou avant ce point
est l'autorisation (auteur + intégrité du corps ci-dessus). Une fois
l'agent lancé, rien n'empêche techniquement une tâche de demander à lire
`.env`, une clé SSH ou les identifiants `gh` — c'est un service systemd
utilisateur (jamais root), avec quelques protections OS de bas niveau
(`NoNewPrivileges`, `PrivateTmp`, etc.), mais **pas** de `ProtectHome` : le
routeur a besoin d'un accès large à `$HOME/projects/*` pour travailler
normalement, donc `ProtectHome` casserait l'outil. Les sorties postées en
commentaire passent par une redaction best-effort (tokens GitHub/AWS/Slack/
Stripe/OpenAI connus, blocs de clé privée, lignes `*_SECRET=`/`*_TOKEN=`/
`*_PASSWORD=`, chaînes de connexion `scheme://user:pass@host`) — ce n'est
qu'un filet de sécurité, pas un remplacement du bon sens de l'agent.

**Anti-boucle.** Une tâche qui échoue reste `agent-failed` et n'est plus
reprise automatiquement (avant ce correctif, une tâche en échec était
retentée à chaque scrutation, soit toutes les 10 s indéfiniment — coût agent
et bruit sur l'issue sans borne). Pour relancer une tâche après correction,
ajoute le label `agent-retry` sur l'issue ; il est consommé automatiquement
dès qu'elle est reprise.

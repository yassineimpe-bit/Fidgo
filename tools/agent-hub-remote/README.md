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

Le worker utilise l'authentification existante du CLI `gh` sur la tour.

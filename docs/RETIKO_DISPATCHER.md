# Dispatcher Retiko V1 — Claude

Le workflow `.github/workflows/retiko-dispatcher.yml` utilise GitHub comme
unique file et source d'état. Il ne remplace pas le reporter de l'issue #224 et
n'écrit jamais directement dans #88 ou #224.

## Cycle et sélection

Une issue ouverte (et non une PR) est sélectionnable avec `agent:claude`,
`auto:yes`, `state:ready` et exactement un risque autorisé. `needs-human`,
`risk:high` et l'absence de `risk:*` l'excluent. L'ordre est `risk:low`, puis
`risk:medium`, puis date de création et numéro. Une issue `state:running`
occupe l'unique worker.

Le groupe de concurrence englobe le claim et Claude. Après la sélection, le
script relit l'issue, revérifie tous les critères, ajoute `state:running`, puis
retire seulement `state:ready`; tous les labels métier sont conservés. L'API
GitHub ne fournit pas de compare-and-swap atomique sur les labels : il existe
donc un bref état à deux labels. La concurrence du workflow sérialise tous les
dispatchers V1 utilisant ce workflow; la relecture protège contre les autres
modifications. Un acteur externe ignorant cette convention reste une limite.

Claude doit créer une branche `retiko/issue-N-claude` et une PR avec le marker
exact `<!-- retiko-dispatch:issue=N -->`. Seule une PR ouverte portant ce marker
fait passer `state:running` à `state:review`. Aucun merge ni fermeture d'issue
n'est effectué. Un échec avant PR passe l'issue à `state:blocked` et ajoute une
raison concise. Il n'y a ni retry applicatif ni moteur de quota; une reprise
demande une reclassification humaine explicite.

## Déclencheurs, activation et labels

Le workflow réagit à l'ajout d'un label, à un lancement manuel et toutes les
heures comme filet de sécurité. La concurrence absorbe les
événements rapprochés et les transitions idempotentes empêchent un second claim.
L'option manuelle `bootstrap_labels` crée de façon idempotente, sans suppression :

`agent:claude`, `auto:yes`, `state:ready`, `state:running`, `state:review`,
`state:blocked`, `risk:low`, `risk:medium`, `risk:high`, `needs-human`.

Ne pas activer un backlog en masse. Après merge, créer les labels une fois,
configurer `CLAUDE_CODE_OAUTH_TOKEN`, puis valider avec une seule issue pilote
non critique en `risk:low`.

## Intégration et permissions

La V1 appelle l'action officielle `anthropics/claude-code-action@v1` avec le
secret recommandé `CLAUDE_CODE_OAUTH_TOKEN`. Une absence de credential ne
révèle aucune valeur : l'issue réclamée devient `state:blocked`. Les permissions
sont limitées à `contents: write` (branche/commit Claude), `pull-requests: write`
(création de PR) et `issues: write` (labels et commentaire de blocage). Aucune
permission d'administration, de déploiement, de checks ou de secrets n'est
accordée. La CI existante reste seule autorité et le dispatcher ne la reproduit
ni ne la contourne.

## Modèle de menace du dépôt public

Le workflow n'écoute aucun événement `pull_request` ou `pull_request_target`.
Une PR externe ne peut donc pas déclencher Claude avec les permissions d'écriture.
Les seuls déclencheurs sont un label d'issue, le schedule et le lancement manuel;
quel que soit le déclencheur, le script ignore son contenu et sélectionne une
issue depuis l'API selon les labels d'autorisation explicites. Le numéro produit
par ce claim est la seule mission transmise à Claude. Le checkout force `main` :
aucun code issu d'une branche de PR n'est récupéré ou exécuté par le dispatcher.

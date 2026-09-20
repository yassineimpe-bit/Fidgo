#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER="$REPO_DIR/tools/agent-hub-remote/remote_worker.py"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/retiko-agent-worker.service"

mkdir -p "$SERVICE_DIR"
chmod +x "$WORKER"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Retiko remote Agent Hub worker
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=/usr/bin/python3 $WORKER
Restart=always
RestartSec=5
Environment=RETIKO_REPO=yassineimpe-bit/Fidgo
Environment=RETIKO_OWNER=yassineimpe-bit
Environment=RETIKO_AGENT_HUB=$HOME/projects/agent-hub/router.py
Environment=RETIKO_POLL_SECONDS=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now retiko-agent-worker.service

echo
echo "Service installé."
echo "Statut : systemctl --user status retiko-agent-worker.service"
echo "Logs   : journalctl --user -u retiko-agent-worker.service -f"

#!/usr/bin/env python3
"""
Retiko remote agent worker.

Polls GitHub issues created by the repository owner whose title starts with
"[retiko-agent]". Each issue becomes one request sent to the local Agent Hub.

No secrets are stored in the repository. Authentication is delegated to the
already-authenticated GitHub CLI ("gh") on the machine running this worker.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = os.environ.get("RETIKO_REPO", "yassineimpe-bit/Fidgo")
OWNER = os.environ.get("RETIKO_OWNER", "yassineimpe-bit")
ROUTER = Path(
    os.environ.get(
        "RETIKO_AGENT_HUB",
        str(Path.home() / "projects" / "agent-hub" / "router.py"),
    )
).expanduser()
TITLE_PREFIX = "[retiko-agent]"
DEFAULT_POLL_SECONDS = int(os.environ.get("RETIKO_POLL_SECONDS", "10"))
RUN_TIMEOUT_SECONDS = int(os.environ.get("RETIKO_RUN_TIMEOUT_SECONDS", "3600"))

STATUS_LABELS = {
    "queued": ("agent-task", "1D76DB", "Remote Retiko agent task"),
    "running": ("agent-running", "FBCA04", "Retiko agent task in progress"),
    "done": ("agent-done", "0E8A16", "Retiko agent task completed"),
    "failed": ("agent-failed", "D1242F", "Retiko agent task failed"),
}


def gh(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["gh", *args],
        text=True,
        capture_output=True,
        check=check,
    )


def ensure_prerequisites() -> None:
    if not ROUTER.exists():
        raise SystemExit(f"Agent Hub introuvable: {ROUTER}")

    try:
        gh("auth", "status")
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise SystemExit(
            "GitHub CLI absent ou non authentifié. Exécute d'abord: gh auth status"
        ) from exc


def ensure_labels() -> None:
    for name, color, description in STATUS_LABELS.values():
        gh(
            "label",
            "create",
            name,
            "--repo",
            REPO,
            "--color",
            color,
            "--description",
            description,
            "--force",
            check=False,
        )


def list_candidate_issues() -> list[dict]:
    result = gh(
        "issue",
        "list",
        "--repo",
        REPO,
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        "number,title,body,author,labels,url",
    )
    issues = json.loads(result.stdout or "[]")

    candidates = []
    for issue in issues:
        title = (issue.get("title") or "").strip()
        author = ((issue.get("author") or {}).get("login") or "").strip()
        labels = {label.get("name") for label in issue.get("labels", [])}

        if not title.lower().startswith(TITLE_PREFIX):
            continue
        if author.lower() != OWNER.lower():
            continue
        if "agent-running" in labels or "agent-done" in labels:
            continue

        candidates.append(issue)

    return sorted(candidates, key=lambda item: item["number"])


def parse_request(issue: dict) -> tuple[str, str]:
    body = (issue.get("body") or "").strip()
    title = (issue.get("title") or "").strip()

    agent = "auto"
    lines = body.splitlines()

    if lines:
        match = re.match(
            r"^\s*agent\s*:\s*(auto|claude|codex|agy|team)\s*$",
            lines[0],
            flags=re.IGNORECASE,
        )
        if match:
            agent = match.group(1).lower()
            lines = lines[1:]

    while lines and not lines[0].strip():
        lines.pop(0)

    if lines and re.match(r"^\s*task\s*:\s*$", lines[0], re.IGNORECASE):
        lines = lines[1:]

    task = "\n".join(lines).strip()
    if not task:
        task = title[len(TITLE_PREFIX) :].strip(" :-")

    if not task:
        raise ValueError("Tâche vide.")

    return agent, task


def set_status(number: int, status: str) -> None:
    current = STATUS_LABELS[status][0]
    remove = [
        label_name
        for key, (label_name, _, _) in STATUS_LABELS.items()
        if key != status
    ]

    args = [
        "issue",
        "edit",
        str(number),
        "--repo",
        REPO,
        "--add-label",
        current,
    ]
    for label in remove:
        args.extend(["--remove-label", label])

    gh(*args, check=False)


def comment(number: int, message: str) -> None:
    # GitHub comments have a practical size limit. Keep room for the wrapper.
    if len(message) > 60000:
        message = message[:60000] + "\n\n[sortie tronquée]"
    gh(
        "issue",
        "comment",
        str(number),
        "--repo",
        REPO,
        "--body",
        message,
        check=False,
    )


def build_router_input(agent: str, task: str) -> str:
    if agent == "auto":
        command = task
    elif agent == "team":
        command = f"/team {task}"
    else:
        command = f"/{agent} {task}"

    return command + "\n/quit\n"


def run_router(agent: str, task: str) -> tuple[int, str]:
    payload = build_router_input(agent, task)

    try:
        result = subprocess.run(
            [str(ROUTER)],
            cwd=str(ROUTER.parent),
            input=payload,
            text=True,
            capture_output=True,
            timeout=RUN_TIMEOUT_SECONDS,
        )
        combined = "\n".join(
            part for part in (result.stdout.strip(), result.stderr.strip()) if part
        )
        return result.returncode, combined
    except subprocess.TimeoutExpired as exc:
        partial = "\n".join(
            part
            for part in (
                (exc.stdout or "").strip() if isinstance(exc.stdout, str) else "",
                (exc.stderr or "").strip() if isinstance(exc.stderr, str) else "",
            )
            if part
        )
        return 124, f"Timeout après {RUN_TIMEOUT_SECONDS}s.\n{partial}".strip()


def process_issue(issue: dict) -> None:
    number = issue["number"]

    try:
        agent, task = parse_request(issue)
    except ValueError as exc:
        set_status(number, "failed")
        comment(number, f"❌ Tâche refusée : {exc}")
        return

    set_status(number, "running")
    comment(
        number,
        "🤖 **Retiko Agent Hub a pris la tâche.**\n\n"
        f"- Agent demandé : `{agent}`\n"
        f"- Machine : worker local WSL\n"
        f"- Routeur : `{ROUTER}`",
    )

    code, output = run_router(agent, task)

    if code == 0 and output.strip():
        set_status(number, "done")
        comment(
            number,
            "✅ **Tâche terminée**\n\n"
            "<details><summary>Sortie Agent Hub</summary>\n\n"
            "```text\n"
            f"{output}\n"
            "```\n"
            "</details>",
        )
        gh(
            "issue",
            "close",
            str(number),
            "--repo",
            REPO,
            "--reason",
            "completed",
            check=False,
        )
    else:
        set_status(number, "failed")
        comment(
            number,
            "❌ **La tâche a échoué.**\n\n"
            f"Code de sortie : `{code}`\n\n"
            "```text\n"
            f"{output or '(aucune sortie)'}\n"
            "```",
        )


def run_once() -> int:
    issues = list_candidate_issues()
    if not issues:
        return 0

    for issue in issues:
        process_issue(issue)

    return len(issues)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--once",
        action="store_true",
        help="Traite les tâches disponibles puis quitte.",
    )
    parser.add_argument(
        "--poll",
        type=int,
        default=DEFAULT_POLL_SECONDS,
        help="Intervalle de polling GitHub en secondes.",
    )
    args = parser.parse_args()

    ensure_prerequisites()
    ensure_labels()

    if args.once:
        count = run_once()
        print(f"{count} tâche(s) traitée(s).")
        return

    print(
        f"Retiko remote worker actif | repo={REPO} | owner={OWNER} "
        f"| router={ROUTER} | poll={args.poll}s"
    )

    while True:
        try:
            run_once()
        except KeyboardInterrupt:
            print("\nArrêt demandé.")
            return
        except Exception as exc:
            print(f"[worker] erreur: {exc}", file=sys.stderr)

        time.sleep(max(5, args.poll))


if __name__ == "__main__":
    main()

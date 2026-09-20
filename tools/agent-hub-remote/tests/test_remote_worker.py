"""
Mocked tests for remote_worker.py. No real `gh` call, no network, no real
secrets: every value below is a fixture, not a credential.

Run with:  python3 -m unittest discover -s tools/agent-hub-remote/tests -v
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parent.parent / "remote_worker.py"


def load_module():
    spec = importlib.util.spec_from_file_location("remote_worker_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


rw = load_module()
OWNER = rw.OWNER  # "yassineimpe-bit" by default, not a secret


def make_issue(number=1, author=OWNER, labels=None, body="task:\ndo the thing", title="[retiko-agent] test"):
    return {
        "number": number,
        "title": title,
        "body": body,
        "author": {"login": author},
        "labels": [{"name": name} for name in (labels or [])],
        "url": f"https://github.com/example/example/issues/{number}",
    }


def fake_completed(stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(args=["gh"], returncode=returncode, stdout=stdout, stderr=stderr)


def graphql_response(*, last_edited_at=None, editor_login=None, include_editor_key=True, include_last_edited_key=True):
    issue_node = {}
    if include_last_edited_key:
        issue_node["lastEditedAt"] = last_edited_at
    if include_editor_key:
        issue_node["editor"] = {"login": editor_login} if editor_login else None
    payload = {"data": {"repository": {"issue": issue_node}}}
    return fake_completed(stdout=json.dumps(payload))


class BodyIntegrityTests(unittest.TestCase):
    """issue.author never changes when someone else edits the body -- these
    cover the editor/lastEditedAt check meant to catch that."""

    @patch.object(rw, "gh")
    def test_never_edited_is_accepted(self, mock_gh):
        mock_gh.return_value = graphql_response(last_edited_at=None, editor_login=None)
        self.assertTrue(rw.body_is_untampered(make_issue(author=OWNER)))

    @patch.object(rw, "gh")
    def test_edited_by_same_author_is_accepted(self, mock_gh):
        mock_gh.return_value = graphql_response(last_edited_at="2026-01-01T00:00:00Z", editor_login=OWNER)
        self.assertTrue(rw.body_is_untampered(make_issue(author=OWNER)))

    @patch.object(rw, "gh")
    def test_edited_by_someone_else_is_rejected(self, mock_gh):
        mock_gh.return_value = graphql_response(last_edited_at="2026-01-01T00:00:00Z", editor_login="a-collaborator")
        self.assertFalse(rw.body_is_untampered(make_issue(author=OWNER)))

    @patch.object(rw, "gh")
    def test_editor_login_case_is_ignored(self, mock_gh):
        # GitHub logins are case-insensitive; the comparison must be too.
        mock_gh.return_value = graphql_response(last_edited_at="2026-01-01T00:00:00Z", editor_login=OWNER.upper())
        self.assertTrue(rw.body_is_untampered(make_issue(author=OWNER)))

    @patch.object(rw, "gh")
    def test_repository_null_is_rejected(self, mock_gh):
        # e.g. a misconfigured owner/repo -- GraphQL returns null, not an error.
        mock_gh.return_value = fake_completed(stdout=json.dumps({"data": {"repository": None}}))
        self.assertFalse(rw.body_is_untampered(make_issue()))

    @patch.object(rw, "gh")
    def test_issue_null_is_rejected(self, mock_gh):
        mock_gh.return_value = fake_completed(stdout=json.dumps({"data": {"repository": {"issue": None}}}))
        self.assertFalse(rw.body_is_untampered(make_issue()))

    @patch.object(rw, "gh")
    def test_missing_data_key_is_rejected(self, mock_gh):
        mock_gh.return_value = fake_completed(stdout=json.dumps({"errors": [{"message": "boom"}]}))
        self.assertFalse(rw.body_is_untampered(make_issue()))

    @patch.object(rw, "gh")
    def test_malformed_json_is_rejected(self, mock_gh):
        mock_gh.return_value = fake_completed(stdout="not json at all")
        self.assertFalse(rw.body_is_untampered(make_issue()))

    @patch.object(rw, "gh")
    def test_empty_stdout_is_rejected(self, mock_gh):
        mock_gh.return_value = fake_completed(stdout="")
        self.assertFalse(rw.body_is_untampered(make_issue()))

    @patch.object(rw, "gh")
    def test_gh_cli_error_is_rejected(self, mock_gh):
        mock_gh.side_effect = subprocess.CalledProcessError(1, ["gh"], stderr="not authenticated")
        self.assertFalse(rw.body_is_untampered(make_issue()))

    @patch.object(rw, "gh")
    def test_missing_lastEditedAt_field_is_rejected(self, mock_gh):
        # Schema anomaly: field absent entirely, not just null. Must not
        # silently degrade to "never edited".
        mock_gh.return_value = graphql_response(editor_login=None, include_last_edited_key=False)
        self.assertFalse(rw.body_is_untampered(make_issue()))

    @patch.object(rw, "gh")
    def test_missing_editor_field_is_rejected(self, mock_gh):
        mock_gh.return_value = graphql_response(last_edited_at="2026-01-01T00:00:00Z", include_editor_key=False)
        self.assertFalse(rw.body_is_untampered(make_issue()))


class CandidateFilteringAntiReplayTests(unittest.TestCase):
    """State machine: queued -> running -> done|failed, plus the explicit
    agent-retry escape hatch for a single retry of a failed task."""

    @patch.object(rw, "gh")
    def _candidates_for(self, labels, mock_gh):
        issues = [make_issue(1, labels=labels)]
        mock_gh.return_value = fake_completed(stdout=json.dumps(issues))
        return rw.list_candidate_issues()

    def test_running_issue_is_never_picked_up_twice(self):
        self.assertEqual(self._candidates_for(["agent-running"]), [])

    def test_done_issue_is_never_replayed(self):
        self.assertEqual(self._candidates_for(["agent-done"]), [])

    def test_failed_issue_without_retry_label_is_never_replayed(self):
        self.assertEqual(self._candidates_for(["agent-failed"]), [])

    def test_failed_issue_with_retry_label_is_retried_once(self):
        candidates = self._candidates_for(["agent-failed", "agent-retry"])
        self.assertEqual([c["number"] for c in candidates], [1])

    def test_fresh_issue_with_no_labels_is_a_candidate(self):
        candidates = self._candidates_for([])
        self.assertEqual([c["number"] for c in candidates], [1])

    @patch.object(rw, "gh")
    def test_retry_label_is_consumed_when_run_starts(self, mock_gh):
        mock_gh.return_value = fake_completed()
        rw.set_status(1, "running")
        call_args = mock_gh.call_args.args
        remove_positions = [i for i, a in enumerate(call_args) if a == "--remove-label"]
        removed = [call_args[i + 1] for i in remove_positions]
        self.assertIn(rw.RETRY_LABEL, removed)


class RedactionTests(unittest.TestCase):
    """All values here are fixtures shaped like real secrets, never real
    secrets, per the constraint not to put actual credentials in tests."""

    def test_redacts_fake_github_token(self):
        text = "auth header: ghp_ABCDEFGHIJ0123456789abcd"
        redacted = rw.redact_secrets(text)
        self.assertNotIn("ghp_ABCDEFGHIJ0123456789abcd", redacted)
        self.assertIn("[REDACTED]", redacted)

    def test_redacts_fake_fine_grained_pat(self):
        text = "token=github_pat_11AAAAAAA0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        self.assertNotIn("github_pat_", rw.redact_secrets(text))

    def test_redacts_fake_openai_style_api_key(self):
        text = "OPENAI_API_KEY=sk-FAKEFAKEFAKEFAKEFAKE1234"
        redacted = rw.redact_secrets(text)
        self.assertNotIn("sk-FAKEFAKEFAKEFAKEFAKE1234", redacted)

    def test_redacts_fake_aws_key(self):
        text = "leaked: AKIAFAKEFAKEFAKEFAKE"
        self.assertNotIn("AKIAFAKEFAKEFAKEFAKE", rw.redact_secrets(text))

    def test_redacts_fake_env_style_secret_line(self):
        text = "STRIPE_SECRET_KEY=sk_test_fake_value_do_not_use_1234"
        self.assertNotIn("sk_test_fake_value_do_not_use_1234", rw.redact_secrets(text))

    def test_redacts_fake_private_key_block(self):
        text = "-----BEGIN RSA PRIVATE KEY-----\nFAKEFAKEFAKE==\n-----END RSA PRIVATE KEY-----"
        redacted = rw.redact_secrets(text)
        self.assertNotIn("FAKEFAKEFAKE", redacted)

    def test_redacts_fake_connection_string_credentials(self):
        text = "DATABASE_URL=postgres://fakeuser:fakepass@example-host/db"
        redacted = rw.redact_secrets(text)
        self.assertNotIn("fakepass", redacted)

    def test_leaves_harmless_output_untouched(self):
        text = "3 tests passed, 0 failed. See https://example.com/report for details."
        self.assertEqual(rw.redact_secrets(text), text)


class CommentTruncationTests(unittest.TestCase):
    @patch.object(rw, "gh")
    def test_long_output_is_truncated(self, mock_gh):
        mock_gh.return_value = fake_completed()
        rw.comment(1, "x" * 70000)
        body = mock_gh.call_args.args[mock_gh.call_args.args.index("--body") + 1]
        self.assertLessEqual(len(body), 60000 + len("\n\n[sortie tronquée]"))
        self.assertTrue(body.endswith("[sortie tronquée]"))

    @patch.object(rw, "gh")
    def test_short_output_is_not_truncated(self, mock_gh):
        mock_gh.return_value = fake_completed()
        rw.comment(1, "short message")
        body = mock_gh.call_args.args[mock_gh.call_args.args.index("--body") + 1]
        self.assertEqual(body, "short message")


class RunRouterTests(unittest.TestCase):
    @patch.object(rw.subprocess, "run")
    def test_timeout_is_handled_without_raising(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["router"], timeout=1, output="partial", stderr="")
        code, output = rw.run_router("auto", "a task that hangs")
        self.assertEqual(code, 124)
        self.assertIn("Timeout après", output)

    @patch.object(rw.subprocess, "run")
    def test_all_agents_failed_marker_is_treated_as_failure(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            args=["router"], returncode=0, stdout="Tous les agents disponibles ont échoué.", stderr=""
        )
        code, _ = rw.run_router("auto", "task")
        self.assertEqual(code, 1)

    @patch.object(rw.subprocess, "run")
    def test_normal_success_is_returncode_zero(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(args=["router"], returncode=0, stdout="all good", stderr="")
        code, output = rw.run_router("auto", "task")
        self.assertEqual(code, 0)
        self.assertEqual(output, "all good")


class ProcessIssueIntegrationTests(unittest.TestCase):
    """The tamper check must gate everything: a rejected issue must never
    reach run_router, regardless of what its body says."""

    @patch.object(rw, "run_router")
    @patch.object(rw, "comment")
    @patch.object(rw, "set_status")
    @patch.object(rw, "body_is_untampered")
    def test_tampered_issue_never_reaches_the_agent(self, mock_untampered, mock_set_status, mock_comment, mock_run_router):
        mock_untampered.return_value = False
        rw.process_issue(make_issue(1))
        mock_run_router.assert_not_called()
        mock_set_status.assert_called_once_with(1, "failed")
        mock_comment.assert_called_once()

    @patch.object(rw, "run_router")
    @patch.object(rw, "comment")
    @patch.object(rw, "set_status")
    @patch.object(rw, "body_is_untampered")
    @patch.object(rw, "gh")
    def test_untampered_success_closes_the_issue(self, mock_gh, mock_untampered, mock_set_status, mock_comment, mock_run_router):
        mock_gh.return_value = fake_completed()
        mock_untampered.return_value = True
        mock_run_router.return_value = (0, "great success, no secrets here")
        rw.process_issue(make_issue(1, body="task:\ndo the thing"))
        mock_run_router.assert_called_once()
        mock_set_status.assert_any_call(1, "running")
        mock_set_status.assert_any_call(1, "done")
        mock_gh.assert_any_call("issue", "close", "1", "--repo", rw.REPO, "--reason", "completed", check=False)

    @patch.object(rw, "run_router")
    @patch.object(rw, "comment")
    @patch.object(rw, "set_status")
    @patch.object(rw, "body_is_untampered")
    def test_untampered_agent_failure_marks_failed_not_done(self, mock_untampered, mock_set_status, mock_comment, mock_run_router):
        mock_untampered.return_value = True
        mock_run_router.return_value = (1, "something went wrong")
        rw.process_issue(make_issue(1, body="task:\ndo the thing"))
        mock_set_status.assert_any_call(1, "failed")
        self.assertNotIn((1, "done"), [c.args for c in mock_set_status.call_args_list])

    @patch.object(rw, "run_router")
    @patch.object(rw, "comment")
    @patch.object(rw, "set_status")
    @patch.object(rw, "body_is_untampered")
    def test_empty_task_is_rejected_before_running(self, mock_untampered, mock_set_status, mock_comment, mock_run_router):
        mock_untampered.return_value = True
        # Title has nothing after the prefix and body is blank -> parse_request raises.
        rw.process_issue(make_issue(1, title="[retiko-agent]", body=""))
        mock_run_router.assert_not_called()
        mock_set_status.assert_called_once_with(1, "failed")

    @patch.object(rw, "gh")
    @patch.object(rw, "run_router")
    @patch.object(rw, "comment")
    @patch.object(rw, "set_status")
    @patch.object(rw, "body_is_untampered")
    def test_agent_output_is_redacted_before_posting(
        self, mock_untampered, mock_set_status, mock_comment, mock_run_router, mock_gh
    ):
        mock_gh.return_value = fake_completed()
        mock_untampered.return_value = True
        mock_run_router.return_value = (0, "here is a leaked token ghp_ABCDEFGHIJ0123456789abcd")
        rw.process_issue(make_issue(1, body="task:\ndo the thing"))
        posted_bodies = [c.args[1] for c in mock_comment.call_args_list]
        self.assertFalse(any("ghp_ABCDEFGHIJ0123456789abcd" in body for body in posted_bodies))
        self.assertTrue(any("[REDACTED]" in body for body in posted_bodies))


if __name__ == "__main__":
    unittest.main()

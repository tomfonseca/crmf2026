from contextlib import redirect_stdout
import io
import unittest
from unittest.mock import patch

from scripts import tasks


class MailDevTests(unittest.TestCase):
    def test_only_capture_service_is_started(self):
        with patch.object(tasks, "run") as run, patch.object(tasks, "wait_http") as wait, \
                patch.object(tasks, "auth_dev") as auth, redirect_stdout(io.StringIO()):
            tasks.mail_dev()
        run.assert_called_once_with(
            "docker", "compose", "-f", "compose.yaml", "-f", "compose.mail.yaml",
            "up", "-d", "--wait", "--wait-timeout", "60", "mailpit",
        )
        wait.assert_called_once_with("http://localhost:18025/readyz", seconds=15)
        auth.assert_not_called()

    def test_failed_readiness_is_not_reported_as_success(self):
        out = io.StringIO()
        with patch.object(tasks, "run"), \
                patch.object(tasks, "wait_http", side_effect=RuntimeError("unavailable")), \
                redirect_stdout(out), self.assertRaisesRegex(RuntimeError, "unavailable"):
            tasks.mail_dev()
        self.assertNotIn("Local mail capture:", out.getvalue())

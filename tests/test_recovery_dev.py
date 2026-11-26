import base64
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import tasks


class RecoveryDevTests(unittest.TestCase):
    def test_missing_key_never_creates_one_or_starts_services(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(tasks, "ROOT", Path(root)), patch.object(tasks, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "original"):
                    tasks.recovery_dev()
                run.assert_not_called()
            self.assertFalse((Path(root) / ".tools/local-secrets/mfa.key").exists())

    def test_explicit_capture_starts_only_requested_services_and_preserves_custody(self):
        with tempfile.TemporaryDirectory() as root:
            key = Path(root) / ".tools/local-secrets/mfa.key"
            key.parent.mkdir(parents=True)
            original = base64.b64encode(bytes(range(32)))
            key.write_bytes(original)
            with patch.object(tasks, "ROOT", Path(root)), patch.object(tasks, "run") as run, patch.object(tasks, "wait_http"):
                tasks.recovery_dev()
                args = run.call_args.args
                self.assertIn("--no-deps", args)
                self.assertIn("compose.recovery.yaml", args)
                self.assertEqual(args[-5:], ("mailpit", "api", "auth-mail", "hq", "dash"))
                self.assertNotIn("provisioner", args)
                self.assertNotIn("migrate-control", args)
            self.assertEqual(key.read_bytes(), original)

import base64
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from scripts import tasks


class AuthDevTests(unittest.TestCase):
    def test_missing_key_with_encrypted_state_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            def scalar(command, **kwargs):
                sql = command[-1]
                return subprocess.CompletedProcess(command, 0, stdout="t\n" if "to_regclass" in sql else "1\n")
            with patch.object(tasks, "ROOT", Path(directory)), patch.object(tasks, "run"), \
                    patch.object(tasks.subprocess, "run", side_effect=scalar):
                with self.assertRaisesRegex(RuntimeError, "recover the original key"):
                    tasks.auth_dev()
            self.assertFalse((Path(directory) / ".tools/local-secrets/mfa.key").exists())

    def test_missing_key_with_passkey_state_is_not_replaced(self):
        for table in ("passkey_credentials", "passkey_challenges", "recovery_requests", "recovery_limits"):
            with self.subTest(table=table), tempfile.TemporaryDirectory() as directory:
                def scalar(command, **kwargs):
                    sql = command[-1]
                    if "to_regclass" in sql:
                        value = "t" if f"auth.{table}" in sql else "f"
                    else:
                        value = "1"
                    return subprocess.CompletedProcess(command, 0, stdout=value + "\n")
                with patch.object(tasks, "ROOT", Path(directory)), patch.object(tasks, "run"), \
                        patch.object(tasks.subprocess, "run", side_effect=scalar):
                    with self.assertRaisesRegex(RuntimeError, "recover the original key"):
                        tasks.auth_dev()
                self.assertFalse((Path(directory) / ".tools/local-secrets/mfa.key").exists())

    def test_existing_key_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / ".tools/local-secrets/mfa.key"
            key.parent.mkdir(parents=True)
            original = base64.b64encode(bytes(range(32))) + b"\n"
            self.assertEqual(len(base64.b64decode(original)), 32)
            key.write_bytes(original)
            with patch.object(tasks, "ROOT", Path(directory)), patch.object(tasks, "run"), \
                    patch.object(tasks, "wait_http"):
                tasks.auth_dev()
            self.assertEqual(key.read_bytes(), original)

    def test_invalid_existing_key_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / ".tools/local-secrets/mfa.key"
            key.parent.mkdir(parents=True)
            key.write_bytes(b"invalid-synthetic-key")
            with patch.object(tasks, "ROOT", Path(directory)), patch.object(tasks, "run"):
                with self.assertRaisesRegex(RuntimeError, "refusing replacement"):
                    tasks.auth_dev()
            self.assertEqual(key.read_bytes(), b"invalid-synthetic-key")

import unittest
from scripts.check_connector_sql import violations


class PrivacyTests(unittest.TestCase):
    def test_identifiers(self):
        self.assertEqual(violations("SELECT m.valor_tot FROM movment m", ["cpf"]), [])
        self.assertEqual(violations("SELECT u.CPF FROM usuario u", ["cpf"]), ["cpf"])

    def test_wildcards(self):
        self.assertIn("wildcard selection", violations("SELECT m.* FROM movment m", []))
        self.assertIn("wildcard selection", violations("SELECT * FROM movment", []))

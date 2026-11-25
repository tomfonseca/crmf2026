import tempfile
from pathlib import Path
import unittest

from scripts.extrair_schema import generate, infer_relations, parse_table, read_header


def table(name, body):
    return parse_table(f"CREATE TABLE `{name}` (\n{body}\n) ENGINE=InnoDB;", name + ".big")


class SchemaTests(unittest.TestCase):
    def test_composite_key_requires_all_parts(self):
        parent = table("pedido", "  `filial_id` int(11),\n  `pedido_id` int(11),\n  PRIMARY KEY (`filial_id`,`pedido_id`)")
        child = table("item", "  `filial_id` int(10),\n  `pedido_id` int(11)")
        missing = table("incompleto", "  `pedido_id` int(11)")
        relations, _ = infer_relations([parent, child, missing])
        self.assertEqual(len(relations), 1)
        self.assertEqual(relations[0]["columns"], ["filial_id", "pedido_id"])
        self.assertEqual(relations[0]["target_columns"], ["filial_id", "pedido_id"])

    def test_case_insensitive_and_role_prefix(self):
        parent = table("usuario", "  `Usuario_id` int(11),\n  PRIMARY KEY (`Usuario_id`)")
        child = table("log", "  `cad_usuario_id` int(10)")
        relations, _ = infer_relations([parent, child])
        self.assertEqual(len(relations), 1)
        self.assertEqual(relations[0]["target_columns"], ["Usuario_id"])

    def test_rejects_type_mismatch_unsigned_and_external_suffix(self):
        parent = table("produto", "  `produto_id` int(11),\n  PRIMARY KEY (`produto_id`)")
        children = [table("a", "  `produto_id` bigint(20)"),
                    table("b", "  `produto_id` int(11) unsigned"),
                    table("c", "  `produto_id_externo` int(11)")]
        relations, _ = infer_relations([parent] + children)
        self.assertEqual(relations, [])

    def test_index_is_not_unique(self):
        parent = table("produto", "  `produto_id` int(11),\n  KEY `idx` (`produto_id`)")
        child = table("item", "  `produto_id` int(11)")
        self.assertEqual(infer_relations([parent, child])[0], [])

    def test_declared_foreign_key_is_not_inferred(self):
        parent = table("produto", "  `produto_id` int(11),\n  PRIMARY KEY (`produto_id`)")
        child = table("item", "  `produto_id` int(11),\n  CONSTRAINT `fk_prod` FOREIGN KEY (`produto_id`) REFERENCES `produto` (`produto_id`) ON DELETE CASCADE")
        self.assertEqual(child["foreign"][0]["name"], "fk_prod")
        self.assertEqual(child["foreign"][0]["actions"], "ON DELETE CASCADE")
        self.assertEqual(infer_relations([parent, child])[0], [])

    def test_generation_excludes_records_and_preserves_ddl(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ddl = "CREATE TABLE `produto` (\n  `produto_id` int(11),\n  PRIMARY KEY (`produto_id`)\n) ENGINE=InnoDB;"
            dump = root / "produto.big"
            dump.write_text(ddl + "\n-- Dumping data for table `produto`\nINSERT INTO `produto` VALUES ('SEGREDO');\n", encoding="utf-8")
            header, _ = read_header(dump)
            self.assertNotIn("SEGREDO", header)
            output = root / "schema.txt"
            generate(root, output)
            report = output.read_text(encoding="utf-8")
            self.assertIn(ddl, report)
            self.assertNotIn("SEGREDO", report)
            self.assertIn("Tabelas extraidas: 1", report)


if __name__ == "__main__":
    unittest.main()

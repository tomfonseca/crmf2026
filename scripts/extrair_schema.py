"""Extrai somente DDL dos dumps .big e documenta relacoes sem acessar dados.

Uso: python scripts/extrair_schema.py [--db db] [--output schema_relacionamentos.txt]
Nao executa SQL, nao conecta ao banco e nao altera os dumps.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import re


CREATE = re.compile(r"^CREATE TABLE(?: IF NOT EXISTS)? `([^`]+)` \(", re.M)
COLUMN = re.compile(r"^\s+`([^`]+)`\s+(.+?)(?:,)?$", re.M)
FK = re.compile(
    r"(?:CONSTRAINT\s+`([^`]+)`\s+)?FOREIGN KEY\s*(?:`[^`]+`\s*)?"
    r"\(([^)]+)\)\s+REFERENCES\s+(?:`([^`]+)`\.)?`([^`]+)`\s*\(([^)]+)\)([^,\n]*)",
    re.I,
)
ROLES = {"cad", "alt", "apag", "lib", "inc", "exc", "origem", "destino"}


def identifiers(value):
    return re.findall(r"`([^`]+)`", value)


def read_header(path):
    # Limites impedem ler INSERTs gigantes ou carregar dumps de varios GB.
    chunks = []
    size = 0
    with path.open("rb") as source:
        while True:
            line = source.readline(65537)
            if not line:
                break
            if len(line) > 65536:
                raise ValueError(f"{path}: linha de cabecalho maior que 64 KiB")
            if line.startswith((b"-- Dumping data for table", b"INSERT INTO ", b"REPLACE INTO ", b"LOCK TABLES ")):
                break
            chunks.append(line)
            size += len(line)
            if size > 4 * 1024 * 1024:
                raise ValueError(f"{path}: cabecalho maior que 4 MiB")
    raw = b"".join(chunks).replace(b"\r\n", b"\n")
    try:
        return raw.decode("utf-8-sig"), "UTF-8"
    except UnicodeDecodeError:
        return raw.decode("latin-1"), "Latin-1 (fallback)"


def parse_table(ddl, source):
    match = CREATE.search(ddl)
    name = match.group(1)
    columns = dict(COLUMN.findall(ddl))
    primary = re.search(r"^\s+PRIMARY KEY\s*\(([^\n]+)\)", ddl, re.M)
    pk = identifiers(primary.group(1)) if primary else []
    unique = []
    indexes = []
    for line in ddl.splitlines():
        if re.match(r"\s*(?:UNIQUE |FULLTEXT |SPATIAL )?KEY\b", line):
            indexes.append(line.strip().rstrip(","))
        key = re.match(r"\s*UNIQUE KEY\s+`[^`]+`\s*\(([^\n]+)\)", line)
        # Um indice por prefixo nao garante unicidade da coluna inteira.
        if key and not re.search(r"`\s*\(", key.group(1)):
            unique.append(identifiers(key.group(1)))
    foreign = []
    for key in FK.finditer(ddl):
        foreign.append({
            "name": key.group(1) or "(sem nome)",
            "columns": identifiers(key.group(2)),
            "database": key.group(3),
            "target": key.group(4),
            "target_columns": identifiers(key.group(5)),
            "actions": key.group(6).strip(),
        })
    return {"name": name, "source": source, "ddl": ddl, "columns": columns,
            "pk": pk, "unique": unique, "indexes": indexes, "foreign": foreign}


def type_signature(definition):
    # Largura de exibicao de inteiros nao muda o dominio; tamanho e unsigned, sim.
    match = re.match(r"([a-z]+)(\([^)]*\))?(\s+unsigned)?", definition, re.I)
    if not match:
        return None
    base, args, unsigned = match.groups()
    base = {"integer": "int", "numeric": "decimal"}.get(base.lower(), base.lower())
    if base in {"tinyint", "smallint", "mediumint", "int", "bigint"}:
        args = ""
    return base, (args or "").lower(), bool(unsigned)


def infer_relations(tables):
    # Somente nomes de tabelas existentes, sem adivinhar plural, sinonimos ou IDs genericos.
    by_name = {table["name"].lower(): table for table in tables}
    relations = []
    unresolved = []
    for table in tables:
        columns = {name.lower(): name for name in table["columns"]}
        declared = {col.lower() for fk in table["foreign"] for col in fk["columns"]}
        covered = set(declared)
        for lower, original in columns.items():
            if lower in declared:
                continue
            names = [(lower, "nome exato <tabela>_id")]
            role, _, rest = lower.partition("_")
            if role in ROLES:
                names.append((rest, "prefixo de papel + <tabela>_id"))
            candidates = []
            for identifier, reason in names:
                if not identifier.endswith("_id"):
                    continue
                target = by_name.get(identifier[:-3])
                if not target:
                    continue
                target_columns = {name.lower(): name for name in target["columns"]}
                target_id = target_columns.get(identifier)
                if target_id is None:
                    continue
                # O ID precisa pertencer a uma PK ou chave UNIQUE completa.
                keys = ([target["pk"]] if target["pk"] else []) + target["unique"]
                keys = [key for key in keys if target_id in key]
                keys.sort(key=lambda key: (len(key), key))
                for key in keys:
                    source_key = []
                    for part in key:
                        source_col = original if part == target_id else columns.get(part.lower())
                        if source_col is None:
                            break
                        if type_signature(table["columns"][source_col]) != type_signature(target["columns"][part]):
                            break
                        source_key.append(source_col)
                    else:
                        if target is table and source_key == key:
                            continue  # Uma PK nao e uma autorreferencia.
                        candidates.append({"source": table["name"], "columns": source_key,
                                           "target": target["name"], "target_columns": key,
                                           "reason": reason + "; tipos compativeis e PK/UNIQUE completa"})
                        break
            if len(candidates) == 1:
                relations.append(candidates[0])
                covered.update(col.lower() for col in candidates[0]["columns"])
        pk = {col.lower() for col in table["pk"]}
        pending = [name for name in table["columns"]
                   if (name.lower().endswith("_id") or "_id_" in name.lower())
                   and name.lower() not in covered and name.lower() not in pk]
        if pending:
            unresolved.append((table["name"], pending))
    return relations, unresolved


def endpoint(table, columns):
    return f"{table}({', '.join(columns)})"


def generate(db, output):
    files = sorted(db.glob("*.big"))
    if not files:
        raise ValueError(f"Nenhum arquivo .big encontrado em {db}")
    tables = []
    skipped = []
    encodings = Counter()
    database_names = set()
    versions = set()
    for path in files:
        header, encoding = read_header(path)
        encodings[encoding] += 1
        database_names.update(re.findall(r"^-- Host:.*?Database:\s*(\S+)", header, re.M))
        versions.update(re.findall(r"^-- Server version\s+([^\r\n]+)", header, re.M))
        matches = list(CREATE.finditer(header))
        if not matches:
            skipped.append(str(path.as_posix()))
        for match in matches:
            end = re.search(r"^\)[^\r\n]*;\s*$", header[match.start():], re.M)
            if not end:
                raise ValueError(f"CREATE TABLE incompleto: {path}")
            ddl = header[match.start():match.start() + end.end()].rstrip()
            tables.append(parse_table(ddl, path.as_posix()))
    tables.sort(key=lambda table: table["name"].lower())
    if len({table["name"].lower() for table in tables}) != len(tables):
        raise ValueError("Tabelas duplicadas; revisar os dumps antes de gerar")
    if not tables:
        raise ValueError("Nenhuma definicao CREATE TABLE encontrada")
    relations, unresolved = infer_relations(tables)
    declared_count = sum(len(table["foreign"]) for table in tables)
    outgoing = defaultdict(list)
    incoming = defaultdict(list)
    for relation in relations:
        outgoing[relation["source"]].append(relation)
        incoming[relation["target"]].append(relation)
    lines = [
        "SCHEMA E RELACIONAMENTOS DO BANCO", "=" * 80,
        "Gerado em: " + datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "Origem: " + db.as_posix(),
        "Banco(s) informado(s) nos dumps: " + ", ".join(sorted(database_names)),
        "Servidor(es): " + ", ".join(sorted(versions)),
        f"Arquivos .big examinados: {len(files)}",
        f"Tabelas extraidas: {len(tables)}",
        f"Colunas: {sum(len(table['columns']) for table in tables)}",
        f"Chaves estrangeiras declaradas: {declared_count}",
        f"Relacionamentos INFERIDOS: {len(relations)}",
        f"Colunas com nome de ID sem relacao resolvida (exclui PKs): {sum(len(cols) for _, cols in unresolved)}",
        "Decodificacao dos arquivos: " + str(dict(encodings)), "",
        "COMO INTERPRETAR", "-" * 80,
        "DECLARADO: FOREIGN KEY presente no CREATE TABLE; nao verificado no banco ativo.",
        "INFERIDO: hipotese por nomes e tipos; NAO e uma FK e NAO garante integridade.",
        "Inferencia exige <tabela>_id apontando a coluna homonima de tabela existente,",
        "ou prefixo de papel reconhecido (" + ", ".join(sorted(ROLES)) + ").",
        "O destino deve ter PK/UNIQUE completa com tipos compativeis. Chaves compostas",
        "incluem todas as partes; por exemplo, filial_id + identificador local.",
        "As heuristicas sao conservadoras: nao detectam todos os vinculos da aplicacao.",
        "Nomes diferentes, IDs externos, sinonimos e vinculos por numlanc ficam pendentes",
        "ou nao sao inferidos. Mesmo tipos compativeis nao comprovam semantica.",
        "Nao se atribui cardinalidade aos vinculos inferidos; validar regras e dados.",
        "Zero como valor padrao pode indicar ausencia de vinculo, mesmo com NOT NULL.",
        "Conteudo: CREATE TABLE, colunas, defaults, PKs, UNIQUEs, indices e FKs.",
        "Nao inclui registros (INSERT/REPLACE), triggers, rotinas, eventos ou views.",
        "Nenhum SQL foi executado e nenhuma conexao ao banco foi realizada.", "",
        "1. INDICE DE TABELAS", "=" * 80,
    ]
    for i, table in enumerate(tables, 1):
        lines.append(f"{i:04d}. {table['name']} | {len(table['columns'])} colunas | PK: "
                     + (", ".join(table["pk"]) or "(nao declarada)") + f" | {table['source']}")
    lines += ["", "2. CHAVES ESTRANGEIRAS DECLARADAS", "=" * 80]
    if not declared_count:
        lines.append("Nenhuma FOREIGN KEY declarada nas estruturas extraidas.")
    for table in tables:
        for fk in table["foreign"]:
            target = (fk["database"] + "." if fk["database"] else "") + fk["target"]
            lines.append(f"[DECLARADO] {endpoint(table['name'], fk['columns'])} -> "
                         f"{endpoint(target, fk['target_columns'])} | {fk['name']} {fk['actions']}")
    lines += ["", "3. MAPA DE RELACIONAMENTOS INFERIDOS (VALIDAR)", "=" * 80]
    for relation in relations:
        lines.append(f"[INFERIDO] {endpoint(relation['source'], relation['columns'])} -> "
                     f"{endpoint(relation['target'], relation['target_columns'])} | {relation['reason']}")
    lines += ["", "4. ESTRUTURA COMPLETA POR TABELA", "=" * 80]
    for table in tables:
        lines += ["", "TABELA: " + table["name"], "Fonte: " + table["source"], "-" * 80, table["ddl"], "",
                  "Vinculos de saida INFERIDOS:"]
        for relation in outgoing[table["name"]]:
            lines.append("  " + endpoint(table["name"], relation["columns"]) + " -> "
                         + endpoint(relation["target"], relation["target_columns"]))
        if not outgoing[table["name"]]:
            lines.append("  (nenhum pela heuristica)")
        lines.append("Referenciado por (INFERIDO):")
        for relation in incoming[table["name"]]:
            lines.append("  " + endpoint(relation["source"], relation["columns"]) + " -> "
                         + endpoint(table["name"], relation["target_columns"]))
        if not incoming[table["name"]]:
            lines.append("  (nenhum pela heuristica)")
    lines += ["", "5. CAMPOS CANDIDATOS SEM RELACIONAMENTO RESOLVIDO", "=" * 80,
              "Somente nomes *_id ou *_id_* nao cobertos, excluindo a PK propria.",
              "Podem ser IDs externos, campos tecnicos ou relacoes nao reconhecidas."]
    for name, cols in unresolved:
        lines.append(name + ": " + ", ".join(cols))
    lines += ["", "6. ARQUIVOS SEM CREATE TABLE", "=" * 80]
    lines.extend(skipped or ["(nenhum)"])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Gerado: {output} ({output.stat().st_size:,} bytes)")
    print(f"{len(files)} arquivos; {len(tables)} tabelas; {declared_count} FKs declaradas; "
          f"{len(relations)} relacoes inferidas; {len(skipped)} arquivos sem CREATE TABLE")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path("db"))
    parser.add_argument("--output", type=Path, default=Path("schema_relacionamentos.txt"))
    args = parser.parse_args()
    generate(args.db, args.output)

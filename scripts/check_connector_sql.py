"""Reject obvious personal-data identifiers and wildcard extraction SQL."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def violations(sql, forbidden):
    problems = [name for name in forbidden if re.search(r"(?i)(?<![a-z0-9_])" + re.escape(name) + r"(?![a-z0-9_])", sql)]
    if re.search(r"(?i)\bselect\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?\*", sql):
        problems.append("wildcard selection")
    return problems


def check():
    directory = ROOT / "connectors/linxbig"
    forbidden = [line.strip() for line in (directory / "forbidden_columns.txt").read_text().splitlines()
                 if line.strip() and not line.startswith("#")]
    failures = []
    for path in sorted(directory.rglob("*")):
        if path.suffix not in {".sql", ".yaml", ".yml"}:
            continue
        for item in violations(path.read_text(encoding="utf-8"), forbidden):
            failures.append(f"{path.relative_to(ROOT)}: forbidden identifier: {item}")
    if failures:
        raise SystemExit("\n".join(failures))
    print("Connector privacy check passed (M2 must add semantic SQL allowlists).")


if __name__ == "__main__":
    check()

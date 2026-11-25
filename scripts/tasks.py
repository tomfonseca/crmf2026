"""Cross-platform implementations of the repository's Make targets."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
ENV = os.environ.copy()
ENV["PATH"] = str(ROOT / ".tools/go/bin") + os.pathsep + ENV.get("PATH", "")
ENV["MSYS_NO_PATHCONV"] = "1"
TOOLS = {
    "oapi-codegen": "github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.9.0",
    "sqlc": "github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1",
    "golangci-lint": "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0",
    "govulncheck": "golang.org/x/vuln/cmd/govulncheck@v1.10.0",
}


def run(*args, env=None):
    print("+", " ".join(str(arg) for arg in args), flush=True)
    command = [str(arg) for arg in args]
    executable = shutil.which(command[0], path=(env or ENV)["PATH"])
    if executable is None:
        raise RuntimeError(f"Required tool not found: {command[0]}")
    command[0] = executable
    subprocess.run(command, cwd=ROOT, env=env or ENV, check=True)


def tool(name, *args):
    version = TOOLS[name].rsplit("@", 1)[1]
    suffix = ".exe" if os.name == "nt" else ""
    binary = ROOT / ".tools/bin" / f"{name}-{version}{suffix}"
    if binary.exists():
        run(binary, *args)
    else:
        run("go", "run", TOOLS[name], *args)


def gen():
    tool("sqlc", "generate")
    for contract in ("app", "ingest"):
        tool("oapi-codegen", "-config", f"api/{contract}.codegen.yaml", f"api/{contract}.openapi.yaml")
    run("pnpm", "--dir", "web", "gen")
    gofmt()


def gofmt():
    paths = ["cmd", "internal", "migrations"]
    run("gofmt", "-w", *paths)


def wait_http(url, seconds=120):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(2)
    raise RuntimeError(f"Service did not become ready: {url}")


def dev():
    run("docker", "compose", "up", "-d", "--build", "--wait", "--wait-timeout", "240")
    for url in ("http://localhost:8080/readyz", "http://localhost:5173", "http://localhost:5174",
                "http://localhost:18080/realms/crmf/.well-known/openid-configuration"):
        wait_http(url)
    print("Ready: API :8080 | QG :5173 | Dash :5174 | OIDC :18080")


def auth_dev():
    # Explicit one-time local provisioning, never an API startup fallback.
    import base64
    import secrets
    key = ROOT / ".tools" / "local-secrets" / "mfa.key"
    key.parent.mkdir(parents=True, exist_ok=True)
    if not key.exists():
        # Never silently replace a lost key while encrypted MFA state exists.
        run("docker", "compose", "up", "-d", "--wait", "postgres")
        def scalar(sql):
            result = subprocess.run(["docker", "compose", "exec", "-T", "postgres",
                                     "psql", "-U", "crmf_migrator", "-d", "crmf_control",
                                     "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
                                    cwd=ROOT, env=ENV, check=True, capture_output=True, text=True)
            return result.stdout.strip()
        for table in ("users", "login_challenges"):
            if scalar(f"SELECT to_regclass('auth.{table}') IS NOT NULL") == "t":
                column = "mfa_secret_enc" if table == "users" else "secret_enc"
                if scalar(f"SELECT count(*) FROM auth.{table} WHERE {column} IS NOT NULL") != "0":
                    raise RuntimeError("MFA key missing but encrypted state exists; recover the original key")
    try:
        with key.open("xb") as output:
            output.write(base64.b64encode(secrets.token_bytes(32)) + b"\n")
        key.chmod(0o600)
    except FileExistsError:
        pass
    try:
        decoded = base64.b64decode(key.read_bytes().strip(), validate=True)
    except (ValueError, OSError):
        raise RuntimeError("Invalid local MFA key; refusing replacement") from None
    if len(decoded) != 32:
        raise RuntimeError("Invalid local MFA key; refusing replacement")
    run("docker", "compose", "-f", "compose.yaml", "-f", "compose.auth.yaml", "up", "-d", "--build", "api", "worker")
    wait_http("http://localhost:8080/readyz")
    print("Own-auth API enabled locally; no final users are provisioned. SPAs remain mocked.")


def test():
    run("go", "test", "./...")
    run("python", "-m", "unittest", "discover", "-s", "tests", "-v")
    run("pnpm", "--dir", "web", "test")


def lint():
    result = subprocess.run([shutil.which("gofmt", path=ENV["PATH"]), "-l", "cmd", "internal", "migrations"],
                            cwd=ROOT, env=ENV, capture_output=True, text=True, check=True)
    if result.stdout.strip():
        raise RuntimeError("Unformatted Go files:\n" + result.stdout)
    tool("golangci-lint", "run", "--timeout", "5m")
    run("pnpm", "--dir", "web", "lint")
    run("pnpm", "--dir", "web", "typecheck")
    run("python", "scripts/check_connector_sql.py")
    run("terraform", "fmt", "-check", "-recursive", "infra")


def integration():
    run("docker", "compose", "up", "-d", "--wait", "postgres", "mariadb", "azurite")
    run("docker", "compose", "up", "-d", "postgres-bootstrap")
    run("docker", "compose", "wait", "postgres-bootstrap")
    run("go", "test", "-p", "1", "-tags=integration", "./tests/integration", "./internal/server/auth", "./internal/server/httpapi", "-count=1", "-v")


def agent():
    for arch in ("amd64", "386"):
        env = dict(ENV, GOOS="windows", GOARCH=arch, CGO_ENABLED="0")
        for name in ("agent", "updater"):
            run("go", "build", "-trimpath", "-ldflags=-s -w -X main.version=dev",
                "-o", f"bin/windows-{arch}/{name}.exe", f"./cmd/{name}", env=env)


def build():
    run("go", "build", "./...")
    run("pnpm", "--dir", "web", "build")


def fmt():
    gofmt()
    run("pnpm", "--dir", "web", "format")
    run("terraform", "fmt", "-recursive", "infra")


def security():
    tool("govulncheck", "./...")
    run("pnpm", "--dir", "web", "audit", "--audit-level=high")


def check():
    lint()
    test()
    build()
    agent()


if __name__ == "__main__":
    commands = {"dev": dev, "auth-dev": auth_dev, "stop": lambda: run("docker", "compose", "stop"), "test": test,
                "integration": integration, "gen": gen, "lint": lint, "fmt": fmt,
                "agent": agent, "build": build, "check": check, "security": security}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        raise SystemExit("Usage: python scripts/tasks.py " + "|".join(commands))
    try:
        commands[sys.argv[1]]()
    except (subprocess.CalledProcessError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error

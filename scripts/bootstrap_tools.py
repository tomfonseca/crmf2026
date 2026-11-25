"""Install optional prebuilt sqlc/linter under .tools, verifying release SHA-256."""
from pathlib import Path
import hashlib
import io
import json
import os
import platform
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def install(name, repo, version, filename):
    extension = ".exe" if os.name == "nt" else ""
    output = ROOT / ".tools/bin" / f"{name}-{version}{extension}"
    if output.exists():
        return output
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases/tags/{version}",
        headers={"User-Agent": "crmf-tool-bootstrap"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        release = json.load(response)
    asset = next(asset for asset in release["assets"] if asset["name"] == filename)
    digest = asset.get("digest", "")
    if not digest.startswith("sha256:"):
        raise RuntimeError("Release does not publish a SHA-256 digest")
    print(f"Downloading {filename}", flush=True)
    with urllib.request.urlopen(asset["browser_download_url"], timeout=180) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != digest.removeprefix("sha256:"):
        raise RuntimeError("Release checksum mismatch")
    binary_name = name + extension
    if filename.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            member = next(n for n in archive.namelist() if n.split("/")[-1] == binary_name)
            binary = archive.read(member)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            member = next(m for m in archive.getmembers() if m.name.split("/")[-1] == binary_name)
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError("Binary absent from archive")
            binary = source.read()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(binary)
    output.chmod(0o755)
    print(output)
    return output


if __name__ == "__main__":
    system = {"Windows": "windows", "Linux": "linux", "Darwin": "darwin"}[platform.system()]
    arch = {"AMD64": "amd64", "x86_64": "amd64", "arm64": "arm64", "aarch64": "arm64"}[platform.machine()]
    suffix = "zip" if os.name == "nt" else "tar.gz"
    install("sqlc", "sqlc-dev/sqlc", "v1.31.1", f"sqlc_1.31.1_{system}_{arch}.{suffix}")
    install("golangci-lint", "golangci/golangci-lint", "v2.15.0", f"golangci-lint-2.15.0-{system}-{arch}.{suffix}")

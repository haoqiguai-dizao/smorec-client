"""Download verified Microsoft archives into a workspace-local C++ toolchain.

No Visual Studio installer, MSI installation, registry writes, or third-party
bootstrap script is used. See README.md for the selected Microsoft licenses.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request
import zipfile

WORKSPACE = Path(__file__).resolve().parents[2]
LICENSES = (
    ("Visual-Studio-2022-Build-Tools-License.docx",
     "https://visualstudio.microsoft.com/wp-content/uploads/2024/03/"
     "Visual-Studio-2022-Diagnostic-Build-Tools-Agent-License_Update-March-2024_EN.docx"),
    ("Windows-SDK-License.html", "https://aka.ms/WinSDKLicenseURL"),
    ("NET-Reference-Assemblies-License.txt",
     "https://raw.githubusercontent.com/microsoft/dotnet/master/LICENSE"),
)
NUGET_COMPONENTS = (
    ("Microsoft.Windows.SDK.CPP", "10.0.26100.9169", "sdk",
     "https://api.nuget.org/v3/catalog0/data/2026.08.26.05.04.42/microsoft.windows.sdk.cpp.10.0.26100.9169.json"),
    ("Microsoft.Windows.SDK.CPP.x64", "10.0.26100.9169", "sdk-x64",
     "https://api.nuget.org/v3/catalog0/data/2026.08.26.05.05.45/microsoft.windows.sdk.cpp.x64.10.0.26100.9169.json"),
    ("Microsoft.NETFramework.ReferenceAssemblies.net48", "1.0.3", "net48",
     "https://api.nuget.org/v3/catalog0/data/2022.08.19.22.04.09/microsoft.netframework.referenceassemblies.net48.1.0.3.json"),
)


def digest(path: Path, algorithm: str) -> bytes:
    result = hashlib.new(algorithm)
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            result.update(block)
    return result.digest()


def fetch(url: str, path: Path, expected: bytes | None = None,
          algorithm: str = "sha256") -> None:
    if path.exists() and (expected is None or digest(path, algorithm) == expected):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "FrameFlow-Toolchain/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response, partial.open("wb") as stream:
                shutil.copyfileobj(response, stream, 1024 * 1024)
            if expected is not None and digest(partial, algorithm) != expected:
                raise ValueError(f"Hash mismatch: {path.name}")
            partial.replace(path)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def extract(archive: Path, target: Path, vsix: bool) -> int:
    count = 0
    target = target.resolve()
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            name = entry.filename.replace("\\", "/")
            if vsix:
                if not name.startswith("Contents/"):
                    continue
                name = name.removeprefix("Contents/")
            destination = (target / name).resolve()
            if not destination.is_relative_to(target):
                raise ValueError(f"Unsafe archive path: {entry.filename}")
            if entry.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with package.open(entry) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
                count += 1
    return count


def make_plan(root: Path) -> list[dict]:
    # Component URLs and hashes are pinned separately from the mutable channel.
    # See README.md for the upstream catalog hash discrepancy found during setup.
    lock = Path(__file__).with_name("components.lock.json")
    result = json.loads(lock.read_text(encoding="utf-8"))["components"]
    for package, version, target, catalog_url in NUGET_COMPONENTS:
        metadata_path = root / "metadata" / f"{package}.{version}.json"
        fetch(catalog_url, metadata_path)
        metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
        lower = package.lower()
        file = f"{lower}.{version}.nupkg"
        result.append({"id": package, "version": version, "file": file,
                       "url": f"https://api.nuget.org/v3-flatcontainer/{lower}/{version}/{file}",
                       "size": metadata["packageSize"], "sha512": metadata["packageHash"],
                       "catalog": catalog_url, "licenseUrl": metadata.get("licenseUrl"),
                       "target": target, "vsix": False})
    return result


def extract_netfx_cab(archive: Path, target: Path) -> int:
    """Expand only SDK headers and x64 import libs; never invoke the MSI."""
    extracted = target / "cab-files"
    extracted.mkdir(parents=True, exist_ok=True)
    for prefix, folder in (("SDK_netfx_headers_", "include/um"),
                           ("SDK_netfx_libs_amd64_", "lib/x64")):
        subprocess.run(["expand.exe", f"-F:{prefix}*", str(archive), str(extracted)],
                       check=True, capture_output=True)
        destination = target / folder
        destination.mkdir(parents=True, exist_ok=True)
        for file in extracted.glob(prefix + "*"):
            filename = file.name.removeprefix(prefix).removesuffix("_F")
            shutil.copy2(file, destination / filename)
    return sum(1 for path in target.rglob("*") if path.is_file())


def prepare_package(root: Path, package: dict) -> dict:
    archive = root / "downloads" / package["file"]
    algorithm = "sha512" if "sha512" in package else "sha256"
    expected = (base64.b64decode(package["sha512"]) if algorithm == "sha512"
                else bytes.fromhex(package["sha256"]))
    print(f"Downloading {package['id']} ({package['size'] / 1048576:.1f} MiB)", flush=True)
    fetch(package["url"], archive, expected, algorithm)
    package["verifiedSha256"] = digest(archive, "sha256").hex()
    package["downloadedBytes"] = archive.stat().st_size
    if package.get("format") == "netfx-cab":
        count = extract_netfx_cab(archive, root / package["target"])
    elif package.get("format") == "retain-only":
        count = 0
    else:
        count = extract(archive, root / package["target"], package["vsix"])
    package["filesExtracted"] = count
    print(f"Verified and extracted {package['id']}", flush=True)
    return package


def retain_licenses(root: Path) -> None:
    records = []
    for filename, url in LICENSES:
        destination = root / "licenses" / filename
        fetch(url, destination)
        records.append({"file": filename, "url": url,
                        "sha256": digest(destination, "sha256").hex()})
    (root / "licenses" / "sources.json").write_text(
        json.dumps(records, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=WORKSPACE / ".native-build-tools")
    parser.add_argument("--plan-only", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    allowed = (WORKSPACE / ".native-build-tools", WORKSPACE / "native" / "tools")
    if not any(root.is_relative_to(path.resolve()) for path in allowed):
        parser.error("Toolchain must remain inside .native-build-tools or native/tools.")
    root.mkdir(parents=True, exist_ok=True)
    plan = make_plan(root)
    (root / "download-plan.json").write_text(json.dumps(plan, indent=2), encoding="utf-8")
    print(f"Pinned payload plan: {sum(p['size'] for p in plan) / 1048576:.1f} MiB", flush=True)
    if args.plan_only:
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        completed = list(pool.map(lambda package: prepare_package(root, package), plan))
    (root / "download-receipt.json").write_text(json.dumps(completed, indent=2), encoding="utf-8")
    retain_licenses(root)
    print(f"Toolchain archives extracted to {root}", flush=True)


if __name__ == "__main__":
    main()

"""Fetch pinned official ASR-only runtimes; no private cache or unused TTS engine."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import tarfile
import urllib.request


URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.29/sherpa-onnx-v1.12.29-osx-universal2-shared-no-tts.tar.bz2"
SHA256 = "a6149e3bcfce6d9c45dc7bb67f807af553f5dc48ba0268bcb364bb369933dfb6"


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            value.update(block)
    return value.hexdigest()


def main():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("The public speech runtime preparation targets macOS arm64")
    root = Path(__file__).resolve().parents[2]
    output = root / "output/speech-runtime"
    output.mkdir(parents=True, exist_ok=True)
    archive = Path(os.environ.get("XIAOLU_SPEECH_ARCHIVE", output / "upstream-no-tts.tar.bz2"))
    if not archive.exists():
        with urllib.request.urlopen(URL, timeout=90) as response, archive.open("wb") as destination:
            while block := response.read(1024 * 1024):
                destination.write(block)
    if archive.is_symlink() or digest(archive) != SHA256:
        raise SystemExit("Speech runtime archive hash mismatch")
    vendor = root / "native/macos/Vendor/SherpaOnnx"
    if vendor.is_symlink() or not (vendor / "LICENSE-APACHE-2.0.txt").is_file():
        raise SystemExit("Unexpected vendor destination")
    if digest(vendor / "c-api.h") != "7eb1b528e125c730c36036d2df0d663d7ca2bdbadbc1c172a5611ee687907534":
        raise SystemExit("Review changed C API header before using the pinned upstream runtime")
    rows = []
    with tarfile.open(archive) as bundle:
        for name in ("libsherpa-onnx-c-api.dylib", "libonnxruntime.1.23.2.dylib"):
            matches = [item for item in bundle.getmembers() if item.isfile() and Path(item.name).name == name]
            if len(matches) != 1:
                raise SystemExit("Expected one regular upstream library: " + name)
            full = output / ("universal-" + name)
            with bundle.extractfile(matches[0]) as source, full.open("wb") as destination:
                while block := source.read(1024 * 1024):
                    destination.write(block)
            thin = output / name
            subprocess.run(["lipo", str(full), "-thin", "arm64", "-output", str(thin)], check=True)
            symbols = subprocess.check_output(["nm", str(thin)], text=True)
            if name.startswith("libsherpa") and re.search(r"\b_espeak_(?:ng_)?\w+", symbols):
                raise SystemExit("Unexpected unused speech-synthesis engine in ASR-only runtime")
            target = vendor / name
            if target.is_symlink():
                raise SystemExit("Refusing linked library destination")
            target.write_bytes(thin.read_bytes())
            target.chmod(0o755)
            rows.append({"file": name, "sha256": digest(target), "bytes": target.stat().st_size})
    receipt = {"source": URL, "archiveSha256": SHA256, "sherpaVersion": "1.12.29",
               "gitCommit": "3595893df30c2e3cd1b407d51de29dd532c47b86", "tts": False, "files": rows}
    (vendor / "PUBLIC-RUNTIME.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()

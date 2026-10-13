"""Archive exactly the already-built application, verifying the installed managed-file list."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
output = root / package["build"]["directories"]["output"]
app = output / "win-unpacked"
manifest = json.loads((app / "smorec-update-files.json").read_text(encoding="utf-8"))
assert manifest["version"] == package["version"]
archive = output / f"小录-{package['version']}-app-update.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zipped:
    for item in manifest["files"]:
        source = app / item["path"]
        assert source.resolve().is_relative_to(app.resolve()) and not source.is_symlink()
        assert source.stat().st_size == item["size"]
        assert hashlib.file_digest(source.open("rb"), "sha256").hexdigest() == item["sha256"], item["path"]
        zipped.write(source, item["path"])
    zipped.write(app / "smorec-update-files.json", "smorec-update-files.json")
print(json.dumps({"version": package["version"], "archive": str(archive), "size": archive.stat().st_size}, ensure_ascii=False))

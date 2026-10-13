"""Build a portable macOS arm64 FFmpeg and retain its complete matching sources.

Dependencies: Apple command line tools, make, pkg-config/pkgconf, Meson, Ninja, Python 3.12+.
Nothing is installed globally; output/ffmpeg-gpl and this checkout's dependency
binary are the only destinations. This does not package or publish XiaoLu.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request


SOURCES = [
    {
        "name": "ffmpeg-6.1.1.tar.xz",
        "url": "https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz",
        "sha256": "8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968",
        "directory": "ffmpeg-6.1.1",
    },
    {
        "name": "x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz",
        "url": "https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz",
        "sha256": "cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9",
        "directory": "x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55",
    },
    {
        "name": "libwebp-1.6.0.tar.gz",
        "url": "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz",
        "sha256": "e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564",
        "directory": "libwebp-1.6.0",
    },
    {
        "name": "dav1d-1.5.3.tar.xz",
        "url": "https://downloads.videolan.org/pub/videolan/dav1d/1.5.3/dav1d-1.5.3.tar.xz",
        "sha256": "732010aa5ef461fa93355ed2c6c5fedb48ddc4b74e697eaabe8907eaeb943011",
        "directory": "dav1d-1.5.3",
    },
    {
        "name": "libvpx-1.15.0.tar.gz",
        "url": "https://github.com/webmproject/libvpx/archive/refs/tags/v1.15.0.tar.gz",
        "sha256": "e935eded7d81631a538bfae703fd1e293aad1c7fd3407ba00440c95105d2011e",
        "directory": "libvpx-1.15.0",
    },
]


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(command, directory, env, log):
    log.write("\n" + " ".join(command) + "\n")
    log.flush()
    subprocess.run(command, cwd=directory, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)


def archive_corresponding_source(output, sources, receipt_path):
    """Package the pinned inputs and an independently usable build guide."""
    recipe = Path(__file__).resolve()
    shutil.copyfile(recipe, sources / recipe.name)
    (sources / "BUILD.md").write_text(
        "# Rebuild FFmpeg independently\n\n"
        "Use macOS arm64, Python 3.12+, Apple command line tools, make, pkg-config/pkgconf, Meson and Ninja. "
        "Keep these tools on PATH. No XiaoLu checkout, signing key or previously built library is required.\n\n"
        "From this sources directory run:\n\n"
        "```sh\npython3 build-gpl-ffmpeg.py --build-root /absolute/path/to/new-build "
        "--sources-dir .\n```\n\n"
        "The recipe validates each upstream archive before extracting it, builds the five pinned components, "
        "and writes the executable, licenses, receipt and corresponding source into the new build's "
        "output/ffmpeg-gpl. SOURCE-BUILD.json records this binary's original configuration and toolchain. "
        "A different directory or toolchain need not produce identical bytes.\n"
    )
    with tarfile.open(output / "ffmpeg-corresponding-source.tar.gz", "w:gz") as archive:
        archive.add(sources, arcname="sources")
        archive.add(receipt_path, arcname="SOURCE-BUILD.json")


def main():
    if sys.version_info < (3, 12):
        raise SystemExit('Python 3.12+ required; choose that interpreter explicitly when several versions are installed')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-root", type=Path, help="Standalone empty build root; no XiaoLu/client checkout needed")
    parser.add_argument("--sources-dir", type=Path, help="Reuse downloaded archives after SHA256 verification")
    parser.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 2))
    args = parser.parse_args()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("This recipe is for macOS arm64; Windows uses the upstream Windows binary plus its source/license notices.")
    root = args.build_root.resolve() if args.build_root else Path(__file__).resolve().parents[2]
    root.mkdir(parents=True, exist_ok=True)
    output = root / "output/ffmpeg-gpl"
    if output.exists():
        raise SystemExit("output/ffmpeg-gpl already exists; retain it or remove this generated build after verifying it is no longer needed")
    compiler = shutil.which("clang")
    pkg_config = shutil.which(os.environ.get("PKG_CONFIG", "pkg-config"))
    if not compiler or not pkg_config or not shutil.which("make"):
        raise SystemExit("Install Apple command line tools and pkg-config, or set PKG_CONFIG to a local executable")
    output.mkdir(parents=True)
    sources = output / "sources"
    sources.mkdir()
    work = output / "work"
    work.mkdir()
    for item in SOURCES:
        archive = sources / item["name"]
        cached = args.sources_dir / item["name"] if args.sources_dir else None
        if cached and cached.is_file():
            shutil.copyfile(cached, archive)
        else:
            with urllib.request.urlopen(item["url"], timeout=90) as response, archive.open("wb") as destination:
                shutil.copyfileobj(response, destination)
        if digest(archive) != item["sha256"]:
            raise SystemExit("Source hash mismatch: " + item["name"])
        with tarfile.open(archive) as bundle:
            bundle.extractall(work, filter="data")
    prefix = output / "prefix"
    x264 = work / SOURCES[1]["directory"]
    ffmpeg = work / SOURCES[0]["directory"]
    webp = work / SOURCES[2]["directory"]
    dav1d = work / SOURCES[3]["directory"]
    vpx = work / SOURCES[4]["directory"]
    minimum_os = "15.0"
    env = dict(os.environ, PKG_CONFIG=pkg_config, PKG_CONFIG_PATH=str(prefix / "lib/pkgconfig"),
               MACOSX_DEPLOYMENT_TARGET=minimum_os, LC_ALL="C")
    minimum_flag = "-mmacosx-version-min=" + minimum_os
    x264_args = ["./configure", "--prefix=" + str(prefix), "--enable-static", "--disable-cli", "--disable-opencl",
                 "--extra-cflags=" + minimum_flag, "--extra-ldflags=" + minimum_flag]
    webp_args = ["./configure", "--prefix=" + str(prefix), "--disable-shared", "--enable-static",
                 "--disable-libpng", "--disable-libjpeg", "--disable-libtiff", "--disable-gif",
                 "CFLAGS=-O2 " + minimum_flag, "LDFLAGS=" + minimum_flag]
    dav1d_args = ["meson", "setup", "build", "--prefix=" + str(prefix), "--default-library=static",
                  "--buildtype=release", "-Denable_tools=false", "-Denable_tests=false", "-Dc_args=" + minimum_flag]
    vpx_args = ["./configure", "--prefix=" + str(prefix), "--disable-shared", "--enable-static",
                "--disable-examples", "--disable-tools", "--disable-docs", "--disable-unit-tests"]
    env["CFLAGS"] = "-O2 " + minimum_flag
    env["CXXFLAGS"] = "-O2 " + minimum_flag
    env["LDFLAGS"] = minimum_flag
    ffmpeg_args = ["./configure", "--prefix=" + str(prefix), "--cc=" + compiler,
                   "--pkg-config=" + pkg_config, "--pkg-config-flags=--static",
                   "--extra-cflags=" + minimum_flag, "--extra-ldflags=" + minimum_flag,
                   "--enable-gpl", "--enable-version3", "--enable-libx264", "--enable-libwebp", "--enable-libdav1d", "--enable-libvpx",
                   "--disable-autodetect", "--enable-videotoolbox", "--enable-audiotoolbox",
                   "--enable-securetransport", "--enable-zlib", "--disable-shared", "--enable-static",
                   "--disable-debug", "--disable-doc", "--disable-ffplay", "--disable-ffprobe"]
    with (output / "build.log").open("w") as log:
        run(dav1d_args, dav1d, env, log)
        run(["meson", "compile", "-C", "build", "-j", str(args.jobs)], dav1d, env, log)
        run(["meson", "install", "-C", "build"], dav1d, env, log)
        run(vpx_args, vpx, env, log)
        run(["make", "-j" + str(args.jobs)], vpx, env, log)
        run(["make", "install"], vpx, env, log)
        for directory, configuration in [(x264, x264_args), (webp, webp_args), (ffmpeg, ffmpeg_args)]:
            run(configuration, directory, env, log)
            run(["make", "-j" + str(args.jobs)], directory, env, log)
            run(["make", "install"], directory, env, log)
    binary = prefix / "bin/ffmpeg"
    version = subprocess.check_output([str(binary), "-version"], text=True)
    license_text = subprocess.check_output([str(binary), "-L"], text=True)
    libraries = subprocess.check_output(["otool", "-L", str(binary)], text=True)
    if "--enable-nonfree" in version or "unredistributable" in license_text or "/opt/homebrew/" in libraries:
        raise SystemExit("Refusing nonredistributable or machine-dependent build")
    receipt = {
        "schema": 1, "platform": "darwin-arm64", "minimumMacOS": minimum_os, "license": "GPL-3.0-or-later",
        "sha256": digest(binary), "sources": SOURCES, "modifiedSources": False,
        "x264Configure": x264_args, "webpConfigure": webp_args, "dav1dConfigure": dav1d_args, "libvpxConfigure": vpx_args, "ffmpegConfigure": ffmpeg_args,
        "compiler": subprocess.check_output([compiler, "--version"], text=True),
        "version": version, "dynamicLibraries": libraries,
    }
    receipt_path = output / "SOURCE-BUILD.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    for source, name in [(ffmpeg / "COPYING.GPLv3", "LICENSE.GPLv3"), (webp / "COPYING", "LICENSE.libwebp"),
                         (dav1d / "COPYING", "LICENSE.dav1d"), (vpx / "LICENSE", "LICENSE.libvpx"), (vpx / "PATENTS", "PATENTS.libvpx")]:
        shutil.copyfile(source, output / name)
    (output / "README.txt").write_text("FFmpeg 6.1.1 GPL-3.0-or-later, Copyright (c) 2000-2023 FFmpeg developers. No warranty. Includes x264 GPL-2.0-or-later, libwebp/dav1d/libvpx BSD.\nYou may copy, modify and redistribute under included licenses. Complete matching source archives, build recipe and configuration are in ffmpeg-corresponding-source.tar.gz and SOURCE-BUILD.json. Sources accompany every installer/update at Contents/Resources/ffmpeg. Replace ffmpeg here with your modified arm64 build; local macOS ad-hoc signing may be necessary. No secret key is required to build FFmpeg.\nhttps://ffmpeg.org/legal.html\n")
    archive_corresponding_source(output, sources, receipt_path)
    shutil.copy2(binary, output / "ffmpeg")
    destination = root / "node_modules/ffmpeg-static"
    if not (destination / "package.json").is_file() or destination.is_symlink():
        print(json.dumps({"result": "PASS", "sha256": receipt["sha256"], "output": str(output), "standalone": True}))
        return
    shutil.copy2(binary, destination / "ffmpeg")
    shutil.copyfile(ffmpeg / "COPYING.GPLv3", destination / "ffmpeg.LICENSE")
    shutil.copyfile(webp / "COPYING", destination / "ffmpeg.WEBP-LICENSE")
    shutil.copyfile(receipt_path, destination / "ffmpeg.SOURCE-BUILD.json")
    shutil.copyfile(output / "ffmpeg-corresponding-source.tar.gz", destination / "ffmpeg.CORRESPONDING-SOURCE.tar.gz")
    (destination / "ffmpeg.README").write_text(
        "FFmpeg 6.1.1 + x264, GPL-3.0-or-later, no --enable-nonfree.\n"
        "Exact upstream sources, recipe and configuration: ffmpeg.CORRESPONDING-SOURCE.tar.gz.\n"
        "License: ffmpeg.LICENSE. Per-build receipt: ffmpeg.SOURCE-BUILD.json.\n")
    print(json.dumps({"result": "PASS", "sha256": receipt["sha256"], "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

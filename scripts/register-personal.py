#!/usr/bin/env python3
"""Install a built Claude plugin into the personal Codex marketplace."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path


PLUGIN_NAME = "claude"
SOURCE_PATH = "./plugins/claude"
RUNTIME_FIXED = {
    "bundle.json", "package.json", "package-lock.json", "LICENSE", "THIRD_PARTY_NOTICES.md"
}
PLUGIN_FIXED = {
    ".codex-plugin/plugin.json", "assets/logo.png", "scripts/cca.mjs", "LICENSE", "THIRD_PARTY_NOTICES.md"
}


def validate_logo(path: Path) -> None:
    data = path.read_bytes()
    if (len(data) < 33 or len(data) > 5 * 1024 * 1024
            or data[:8] != b"\x89PNG\r\n\x1a\n"
            or data[8:12] != b"\x00\x00\x00\r"
            or data[12:16] != b"IHDR"):
        raise ValueError("Invalid PNG logo")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    if width != height or not 48 <= width <= 4096:
        raise ValueError("Logo must be square and 48-4096 pixels")


def read_json(path: Path) -> dict:
    result = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(result, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return result


def is_link(path: Path) -> bool:
    if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
        return True
    if os.name == "nt" and path.exists():
        return bool(path.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)
    return False


def listed_files(root: Path) -> list[str]:
    paths = []
    pending = [root]
    while pending:
        directory = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                path = Path(entry.path)
                if is_link(path):
                    raise ValueError(f"Link or junction is not allowed in plugin source: {path}")
                if entry.is_dir(follow_symlinks=False):
                    pending.append(path)
                elif entry.is_file(follow_symlinks=False):
                    paths.append(path.relative_to(root).as_posix())
                else:
                    raise ValueError(f"Unsupported plugin source entry: {path}")
    return sorted(paths)


def allowed_plugin_file(name: str) -> bool:
    if name in PLUGIN_FIXED:
        return True
    parts = name.split("/")
    if len(parts) == 2 and parts[0] == "references" and parts[1].endswith(".md"):
        return True
    if len(parts) == 3 and parts[0] == "skills" and parts[2] == "SKILL.md":
        return True
    if len(parts) >= 3 and parts[:2] == ["runtime", "dist"]:
        return name.endswith(".js") or name == "runtime/dist/runtime/containment.ps1"
    return len(parts) == 2 and parts[0] == "runtime" and parts[1] in RUNTIME_FIXED


def validate_source(source: Path) -> list[str]:
    if not source.is_dir() or is_link(source):
        raise ValueError(f"Plugin source must be a real directory: {source}")
    files = listed_files(source)
    unexpected = [name for name in files if not allowed_plugin_file(name)]
    if unexpected:
        raise ValueError(f"Unexpected plugin source file: {unexpected[0]}")
    if not PLUGIN_FIXED.issubset(files):
        raise ValueError("Plugin source is missing its manifest, launcher, or license notices")
    validate_logo(source / "assets" / "logo.png")
    runtime_files = [name.removeprefix("runtime/") for name in files if name.startswith("runtime/")]
    if not RUNTIME_FIXED.issubset(runtime_files) or "dist/cli.js" not in runtime_files:
        raise ValueError("Plugin runtime is incomplete; run npm run package:plugin first")
    manifest = read_json(source / ".codex-plugin" / "plugin.json")
    package = read_json(source / "runtime" / "package.json")
    bundle = read_json(source / "runtime" / "bundle.json")
    if manifest.get("name") != PLUGIN_NAME or package.get("version") != manifest.get("version"):
        raise ValueError("Plugin name or version does not match its runtime")
    if bundle.get("version") != package["version"] or not isinstance(bundle.get("files"), dict):
        raise ValueError("Runtime bundle manifest is invalid")
    actual = sorted(name for name in runtime_files if name != "bundle.json")
    if actual != sorted(bundle["files"]):
        raise ValueError("Runtime bundle file list does not match the source")
    for name, expected in bundle["files"].items():
        actual_hash = hashlib.sha256((source / "runtime" / name).read_bytes()).hexdigest()
        if actual_hash != expected:
            raise ValueError(f"Runtime bundle hash mismatch: {name}")
    digest = hashlib.sha256(json.dumps(bundle["files"], separators=(",", ":")).encode()).hexdigest()
    if digest != bundle.get("digest"):
        raise ValueError("Runtime bundle digest mismatch")
    return files


def marketplace_payload(path: Path) -> dict:
    if not path.exists():
        return {"name": "personal", "interface": {"displayName": "Personal"}, "plugins": []}
    payload = read_json(path)
    if payload.get("name") != "personal" or not isinstance(payload.get("plugins"), list):
        raise ValueError("Expected a personal marketplace with a plugins array")
    if not all(isinstance(entry, dict) for entry in payload["plugins"]):
        raise ValueError("Every marketplace plugin entry must be an object")
    return payload


def same_files(source: Path, destination: Path, files: list[str]) -> bool:
    if not destination.is_dir() or is_link(destination):
        return False
    try:
        if listed_files(destination) != files:
            return False
        return all((source / name).read_bytes() == (destination / name).read_bytes() for name in files)
    except (OSError, ValueError):
        return False


def install(source: Path, marketplace: Path, replace: bool = False) -> None:
    source = source.absolute()
    marketplace = marketplace.expanduser().absolute()
    if marketplace.name != "marketplace.json" or marketplace.parent.name != "plugins" or marketplace.parent.parent.name != ".agents":
        raise ValueError("Personal marketplace path must end in .agents/plugins/marketplace.json")
    if is_link(marketplace.parent) or is_link(marketplace.parent.parent) or is_link(marketplace):
        raise ValueError("Personal marketplace path cannot contain a link or junction")
    marketplace_root = marketplace.parents[2]
    files = validate_source(source)
    payload = marketplace_payload(marketplace)
    plugins = payload["plugins"]
    matches = [entry for entry in plugins if entry.get("name") == PLUGIN_NAME]
    if len(matches) > 1:
        raise ValueError("Duplicate claude entries in personal marketplace")
    if matches and matches[0].get("source") != {"source": "local", "path": SOURCE_PATH}:
        raise ValueError("Existing claude entry points to a different source")

    destination = marketplace_root / "plugins" / PLUGIN_NAME
    if is_link(destination.parent) or is_link(destination):
        raise ValueError(f"Plugin destination cannot be a link or junction: {destination}")
    if destination.exists() or destination.is_symlink():
        if not same_files(source, destination, files):
            if not replace:
                raise ValueError(f"Plugin destination differs; use --replace to back it up and update: {destination}")
            if not destination.is_dir():
                raise ValueError(f"Plugin destination is not a directory: {destination}")
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = destination.with_name(f"claude.before-{stamp}")
            with tempfile.TemporaryDirectory(prefix=".claude-install-", dir=destination.parent) as staging:
                staged = Path(staging) / PLUGIN_NAME
                staged.mkdir()
                for name in files:
                    target = staged / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source / name, target)
                os.replace(destination, backup)
                try:
                    os.replace(staged, destination)
                except OSError:
                    os.replace(backup, destination)
                    raise
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".claude-install-", dir=destination.parent) as staging:
            staged = Path(staging) / PLUGIN_NAME
            staged.mkdir()
            for name in files:
                target = staged / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source / name, target)
            os.replace(staged, destination)

    if not matches:
        plugins.append({
            "name": PLUGIN_NAME,
            "source": {"source": "local", "path": SOURCE_PATH},
            "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
            "category": "Productivity",
        })
        marketplace.parent.mkdir(parents=True, exist_ok=True)
        if marketplace.exists():
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            shutil.copy2(marketplace, marketplace.with_name(f"marketplace.before-claude-{stamp}.json"))
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=marketplace.parent, prefix=".marketplace-", suffix=".json", delete=False) as out:
            temp_path = Path(out.name)
            json.dump(payload, out, indent=2)
            out.write("\n")
        os.replace(temp_path, marketplace)
    print(f"Registered {PLUGIN_NAME}@personal from {source}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1] / "plugin" / PLUGIN_NAME)
    parser.add_argument("--marketplace-path", type=Path, default=Path.home() / ".agents" / "plugins" / "marketplace.json")
    parser.add_argument("--replace", action="store_true", help="Back up a differing installed plugin before replacing it")
    args = parser.parse_args()
    install(args.source, args.marketplace_path, args.replace)


if __name__ == "__main__":
    main()

"""Synchronize local Tauri app versions without resolving dependencies.

The Web ZIP version is independent from this app version. All inputs and the
complete proposed update are validated before any file is written.
"""

from __future__ import annotations

import copy
import json
import re
import tomllib
from pathlib import Path
from typing import Any


FILES = (
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.lock",
)
_VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")
_VERSION_LINE = re.compile(
    r"^([ \t]*version[ \t]*=[ \t]*)(?:\"[^\"\r\n]*\"|'[^'\r\n]*')"
    r"([ \t]*(?:#[^\r\n]*)?)(\r?)$",
    re.MULTILINE,
)


def validate_version(version: str) -> str:
    """Return a numeric X.Y.Z version, or raise ValueError."""
    if not isinstance(version, str) or _VERSION.fullmatch(version) is None:
        raise ValueError("Version must be numeric X.Y.Z without leading zeroes.")
    return version


def _load(repo: Path) -> dict[str, str]:
    texts = {}
    for filename in FILES:
        path = Path(repo) / filename
        try:
            texts[filename] = path.read_text(encoding="utf-8")
        except OSError as error:
            raise ValueError(f"Cannot read {path}: {error.strerror}") from error
    return texts


def _parse(texts: dict[str, str]) -> dict[str, Any]:
    parsed = {}
    for filename, text in texts.items():
        try:
            parsed[filename] = (
                json.loads(text) if filename.endswith(".json") else tomllib.loads(text)
            )
        except (ValueError, tomllib.TOMLDecodeError) as error:
            raise ValueError(f"Invalid metadata in {filename}: {error}") from error
        if not isinstance(parsed[filename], dict):
            raise ValueError(f"{filename} must contain an object/table.")
    return parsed


def _field(obj: Any, key: str, location: str) -> Any:
    if not isinstance(obj, dict) or key not in obj:
        raise ValueError(f"Missing {location}.{key}")
    return obj[key]


def _string(obj: Any, key: str, location: str) -> str:
    value = _field(obj, key, location)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{location}.{key} must be a nonempty string.")
    return value


def _own_package(data: dict[str, Any], name: str) -> dict[str, Any]:
    packages = _field(data["src-tauri/Cargo.lock"], "package", "Cargo.lock")
    if not isinstance(packages, list) or not all(isinstance(p, dict) for p in packages):
        raise ValueError("Cargo.lock.package must be a list of tables.")
    own = [p for p in packages if p.get("name") == name and "source" not in p]
    if len(own) != 1:
        raise ValueError(f"Cargo.lock must contain exactly one local package {name!r}.")
    return own[0]


def _metadata(data: dict[str, Any]) -> dict[str, str]:
    package = data["package.json"]
    lock = data["package-lock.json"]
    cargo = _field(data["src-tauri/Cargo.toml"], "package", "Cargo.toml")
    config = data["src-tauri/tauri.conf.json"]
    cargo_name = _string(cargo, "name", "Cargo.toml.package")
    npm_root = _field(_field(lock, "packages", "package-lock.json"), "", "package-lock.json.packages")
    own = _own_package(data, cargo_name)
    result = {
        "name": cargo_name,
        "product": _string(config, "productName", "tauri.conf.json"),
        "packageName": _string(package, "name", "package.json"),
        "packageVersion": _string(package, "version", "package.json"),
        "packageLockVersion": _string(lock, "version", "package-lock.json"),
        "packageLockRootVersion": _string(npm_root, "version", "package-lock.json.packages['']"),
        "cargoName": cargo_name,
        "cargoVersion": _string(cargo, "version", "Cargo.toml.package"),
        "configVersion": _string(config, "version", "tauri.conf.json"),
        "cargoLockVersion": _string(own, "version", "Cargo.lock local package"),
    }
    for key, value in result.items():
        if key.endswith("Version"):
            validate_version(value)
    main = (result["packageVersion"], result["cargoVersion"], result["configVersion"])
    if len(set(main)) != 1:
        raise ValueError("package.json, Cargo.toml and tauri.conf.json app versions must agree.")
    result["version"] = main[0]
    return result


def read_metadata(repo: Path) -> dict[str, str]:
    """Read mandatory metadata; stale npm/Cargo app lock versions are allowed."""
    return _metadata(_parse(_load(repo)))


def _dependencies(data: dict[str, Any], name: str) -> list[dict[str, Any]]:
    own = _own_package(data, name)
    return copy.deepcopy([p for p in data["src-tauri/Cargo.lock"]["package"] if p is not own])


def dependency_snapshot(repo: Path) -> list[dict[str, Any]]:
    """Return every foreign Cargo.lock package, including all dependency fields."""
    data = _parse(_load(repo))
    metadata = _metadata(data)
    return _dependencies(data, metadata["name"])


def _replace_version(section: str, version: str, location: str) -> str:
    replaced, count = _VERSION_LINE.subn(
        lambda match: f'{match[1]}"{version}"{match[2]}{match[3]}', section
    )
    if count != 1:
        raise ValueError(f"{location} must contain one literal version assignment.")
    return replaced


def _sections(text: str, header: str) -> list[tuple[int, int]]:
    starts = list(re.finditer(rf"(?m)^[ \t]*{re.escape(header)}[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)", text))
    spans = []
    for start in starts:
        following = re.search(r"(?m)^[ \t]*\[", text[start.end():])
        end = start.end() + following.start() if following else len(text)
        spans.append((start.start(), end))
    return spans


def _cargo_version(text: str, version: str) -> str:
    sections = _sections(text, "[package]")
    if len(sections) != 1:
        raise ValueError("Cargo.toml must contain exactly one [package] table.")
    start, end = sections[0]
    return text[:start] + _replace_version(text[start:end], version, "Cargo.toml [package]") + text[end:]


def _cargo_lock_version(text: str, name: str, version: str) -> str:
    own = []
    for start, end in _sections(text, "[[package]]"):
        package = tomllib.loads(text[start:end])["package"][0]
        if package.get("name") == name and "source" not in package:
            own.append((start, end))
    if len(own) != 1:
        raise ValueError(f"Cannot identify the local Cargo.lock table for {name!r}.")
    start, end = own[0]
    return text[:start] + _replace_version(text[start:end], version, "Cargo.lock local package") + text[end:]


def _verify(metadata: dict[str, str], version: str) -> None:
    for key in (
        "packageVersion", "packageLockVersion", "packageLockRootVersion",
        "cargoVersion", "configVersion", "cargoLockVersion",
    ):
        if metadata[key] != version:
            raise ValueError(f"{key} is {metadata[key]}, expected {version}.")


def verify_metadata(repo: Path, version: str) -> None:
    """Require all app metadata and both lock files to match the target."""
    _verify(read_metadata(repo), validate_version(version))


def update_metadata(repo: Path, version: str) -> None:
    """Update only app versions; validate the entire change before writing."""
    version = validate_version(version)
    repo = Path(repo)
    texts = _load(repo)
    data = _parse(texts)
    metadata = _metadata(data)
    dependencies = _dependencies(data, metadata["name"])
    proposed = dict(texts)
    data["package.json"]["version"] = version
    data["package-lock.json"]["version"] = version
    data["package-lock.json"]["packages"][""]["version"] = version
    data["src-tauri/tauri.conf.json"]["version"] = version
    for filename in ("package.json", "package-lock.json", "src-tauri/tauri.conf.json"):
        proposed[filename] = json.dumps(data[filename], ensure_ascii=False, indent=2) + "\n"
    proposed["src-tauri/Cargo.toml"] = _cargo_version(texts["src-tauri/Cargo.toml"], version)
    proposed["src-tauri/Cargo.lock"] = _cargo_lock_version(texts["src-tauri/Cargo.lock"], metadata["name"], version)
    checked = _parse(proposed)
    _verify(_metadata(checked), version)
    if _dependencies(checked, metadata["name"]) != dependencies:
        raise ValueError("App version update unexpectedly changed Cargo dependencies.")
    for filename in FILES:
        if texts[filename] != proposed[filename]:
            (repo / filename).write_text(proposed[filename], encoding="utf-8")

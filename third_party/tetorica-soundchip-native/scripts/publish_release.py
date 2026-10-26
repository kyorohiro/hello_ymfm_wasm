#!/usr/bin/env python3
"""Publish a verified source release from a GitHub Actions tag job.

The caller must first build/test the same tag. A failed upload leaves a draft;
retries reuse matching assets without replacing an existing release or tag.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from sdk_common import ROOT, metadata


class ReleaseError(ValueError):
    pass


class APIError(ReleaseError):
    def __init__(self, status, method, path):
        self.status = status
        super().__init__(f"GitHub API returned HTTP {status}: {method} {path}")


class SafeRedirect(HTTPRedirectHandler):
    """Asset downloads may redirect to storage; never forward the API token."""
    def redirect_request(self, request, response, code, message, headers, new_url):
        if urlsplit(new_url).scheme != "https":
            raise ReleaseError("GitHub asset download redirected outside HTTPS")
        redirected = super().redirect_request(request, response, code, message, headers, new_url)
        if redirected is not None:
            redirected.remove_header("Authorization")
        return redirected


class GitHubAPI:
    def __init__(self, token):
        self.token = token
        self.opener = build_opener(SafeRedirect())

    def request(self, method, path, *, data=None, content_type="application/json", raw=False):
        url = "https://api.github.com" + path if path.startswith("/") else path
        if urlsplit(url).scheme != "https" or urlsplit(url).netloc not in ("api.github.com", "uploads.github.com"):
            raise ReleaseError("Unexpected GitHub API host")
        headers = {"Authorization": f"Bearer {self.token}", "User-Agent": "tetorica-sdk-release",
                   "X-GitHub-Api-Version": "2022-11-28",
                   "Accept": "application/octet-stream" if raw else "application/vnd.github+json"}
        if data is not None:
            if not isinstance(data, bytes):
                data = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = content_type
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=120) as response:
                result = response.read()
        except HTTPError as error:
            # Do not echo response bodies, request headers or credentials.
            raise APIError(error.code, method, path) from None
        return result if raw else json.loads(result)


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def release_inputs(root, directory, environment):
    meta = metadata(root)
    version = meta["version"]
    tag = f"v{version}"
    require(environment.get("GITHUB_REF") == f"refs/tags/{tag}",
            f"GITHUB_REF must be refs/tags/{tag}, matching sdk.json")
    commit = environment.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "GITHUB_SHA must be a full commit SHA")
    repository = environment.get("GITHUB_REPOSITORY", "")
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository),
            "GITHUB_REPOSITORY must identify an owner/repository")
    require(environment.get("GITHUB_TOKEN"), "GITHUB_TOKEN is required")
    directory = Path(directory)
    require(directory.is_dir() and not directory.is_symlink(), "Release directory must be a real directory")
    name = f"{meta['name']}-{version}-sources.zip"
    payloads = {}
    for filename in (name, "SHA256SUMS"):
        path = directory / filename
        require(path.is_file() and not path.is_symlink(), f"Missing regular release file: {filename}")
        payloads[filename] = path.read_bytes()
    digest = hashlib.sha256(payloads[name]).hexdigest()
    require(payloads["SHA256SUMS"] == f"{digest}  {name}\n".encode("ascii"),
            "SHA256SUMS must contain exactly the source ZIP name and its actual SHA-256")
    require(payloads[name], "Source ZIP must not be empty")
    return meta, tag, commit, repository, payloads


def verify_tag(api, base, tag, expected_commit):
    target = api.request("GET", f"{base}/git/ref/tags/{quote(tag, safe='')}")["object"]
    seen = set()
    for _ in range(16):
        kind, sha = target.get("type"), target.get("sha", "")
        require(re.fullmatch(r"[0-9a-f]{40}", sha), "GitHub tag target has an invalid SHA")
        if kind == "commit":
            require(sha == expected_commit, "Remote tag does not point to GITHUB_SHA")
            return
        require(kind == "tag" and sha not in seen, "Remote tag must resolve to a commit")
        seen.add(sha)
        target = api.request("GET", f"{base}/git/tags/{sha}")["object"]
    raise ReleaseError("Remote tag nesting exceeds the supported limit")


def release_assets(api, base, release_id):
    assets = []
    for page in range(1, 101):
        batch = api.request("GET", f"{base}/releases/{release_id}/assets?per_page=100&page={page}")
        require(isinstance(batch, list), "Invalid GitHub asset listing")
        assets.extend(batch)
        if len(batch) < 100:
            break
    else:
        raise ReleaseError("Too many release assets")
    names = [asset.get("name") for asset in assets]
    require(len(set(names)) == len(names), "Release contains duplicate asset names")
    return {asset["name"]: asset for asset in assets}


def verify_asset(api, base, asset, expected):
    require(asset.get("state") == "uploaded" and asset.get("size") == len(expected),
            f"Existing release asset differs: {asset.get('name')}")
    actual = api.request("GET", f"{base}/releases/assets/{int(asset['id'])}", raw=True)
    require(actual == expected, f"Existing release asset differs: {asset.get('name')}")


def find_release(api, base, tag):
    try:
        return api.request("GET", f"{base}/releases/tags/{quote(tag, safe='')}")
    except APIError as error:
        if error.status != 404:
            raise
    # The by-tag endpoint can hide an unpublished draft. Listing releases with
    # the write-enabled Actions token also exposes drafts so retries find it.
    matches = []
    for page in range(1, 101):
        batch = api.request("GET", f"{base}/releases?per_page=100&page={page}")
        require(isinstance(batch, list), "Invalid GitHub release listing")
        matches.extend(item for item in batch if item.get("tag_name") == tag)
        require(len(matches) <= 1, "Multiple releases already use this tag")
        if len(batch) < 100:
            return matches[0] if matches else None
    raise ReleaseError("Too many releases to safely locate a matching draft")


def publish(root=ROOT, directory=None, environment=None, api=None):
    environment = os.environ if environment is None else environment
    directory = Path(root) / "releases" if directory is None else directory
    meta, tag, commit, repository, payloads = release_inputs(root, directory, environment)
    api = GitHubAPI(environment["GITHUB_TOKEN"]) if api is None else api
    base = f"/repos/{repository}"
    verify_tag(api, base, tag, commit)
    release = find_release(api, base, tag)
    if release is None:
        release = api.request("POST", f"{base}/releases", data={
            "tag_name": tag, "target_commitish": commit, "name": tag,
            "body": "Source archive, build recipes, component licenses and verification tools. "
                    "Verify the source ZIP using SHA256SUMS before extracting it.",
            "draft": True, "prerelease": "-" in meta["version"],
        })
    require(release.get("tag_name") == tag, "Release tag differs from sdk.json")
    release_id = int(release["id"])
    assets = release_assets(api, base, release_id)
    for name, expected in payloads.items():
        if name in assets:
            verify_asset(api, base, assets[name], expected)
    missing = set(payloads) - assets.keys()
    if not release.get("draft"):
        require(not missing, "Published release is missing assets; it will not be changed")
        return release["html_url"]
    for name, expected in payloads.items():
        if name not in missing:
            continue
        upload = f"https://uploads.github.com{base}/releases/{release_id}/assets?{urlencode({'name': name})}"
        api.request("POST", upload, data=expected,
                    content_type="application/zip" if name.endswith(".zip") else "text/plain")
    # A successful HTTP upload alone is insufficient: list and read both assets
    # before exposing the release, including assets reused by a retry.
    assets = release_assets(api, base, release_id)
    require(set(payloads) <= assets.keys(), "Draft release is missing required assets")
    for name, expected in payloads.items():
        verify_asset(api, base, assets[name], expected)
    verify_tag(api, base, tag, commit)
    published = api.request("PATCH", f"{base}/releases/{release_id}", data={"draft": False})
    require(not published.get("draft") and published.get("tag_name") == tag,
            "GitHub did not confirm publication of the expected tag")
    return published["html_url"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / "releases")
    args = parser.parse_args()
    try:
        print(publish(directory=args.directory))
    except (ReleaseError, OSError, KeyError, TypeError) as error:
        print(f"Release publication failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

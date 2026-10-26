"""Offline publication protocol tests; these never contact GitHub."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import sys
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from publish_release import APIError, ReleaseError, SafeRedirect, publish


COMMIT = "a" * 40
OTHER_COMMIT = "b" * 40
TAG_OBJECT = "c" * 40
BASE = "/repos/example/tetorica-soundchip-native"


class FakeAPI:
    def __init__(self):
        self.calls = []
        self.tag = {"type": "commit", "sha": COMMIT}
        self.tag_objects = {}
        self.release = None
        self.assets = {}
        self.contents = {}
        self.fail_upload = None
        self.fail_lookup = None
        self.move_tag_on_upload = False
        self.hide_draft_from_tag = False
        self.listed_releases_override = None

    def add_asset(self, name, content):
        identifier = len(self.contents) + 100
        self.assets[name] = {"id": identifier, "name": name, "size": len(content), "state": "uploaded"}
        self.contents[identifier] = content
        return self.assets[name]

    def existing_release(self, draft=True):
        self.release = {"id": 7, "tag_name": "v0.1.3", "draft": draft,
                        "html_url": "https://github.com/example/tetorica-soundchip-native/releases/tag/v0.1.3"}

    def request(self, method, path, *, data=None, content_type="application/json", raw=False):
        self.calls.append((method, path, copy.deepcopy(data), content_type, raw))
        if method == "GET" and path == f"{BASE}/git/ref/tags/v0.1.3":
            return {"object": copy.deepcopy(self.tag)}
        if method == "GET" and path.startswith(f"{BASE}/git/tags/"):
            return {"object": copy.deepcopy(self.tag_objects[path.rsplit("/", 1)[-1]])}
        if method == "GET" and path == f"{BASE}/releases/tags/v0.1.3":
            if self.fail_lookup:
                raise APIError(self.fail_lookup, method, path)
            if self.release is None or self.hide_draft_from_tag and self.release["draft"]:
                raise APIError(404, method, path)
            return copy.deepcopy(self.release)
        if method == "GET" and path.startswith(f"{BASE}/releases?per_page=100&page="):
            values = self.listed_releases_override
            if values is None:
                values = [self.release] if self.release else []
            page = int(parse_qs(urlsplit(path).query)["page"][0])
            return copy.deepcopy(values[(page - 1) * 100:page * 100])
        if method == "POST" and path == f"{BASE}/releases":
            assert data["draft"] is True
            assert data["target_commitish"] == COMMIT
            self.existing_release()
            return copy.deepcopy(self.release)
        if method == "GET" and path.startswith(f"{BASE}/releases/7/assets?"):
            return copy.deepcopy(list(self.assets.values()))
        if method == "GET" and path.startswith(f"{BASE}/releases/assets/"):
            assert raw
            return self.contents[int(path.rsplit("/", 1)[-1])]
        if method == "POST" and path.startswith(f"https://uploads.github.com{BASE}/releases/7/assets?"):
            name = parse_qs(urlsplit(path).query)["name"][0]
            if self.fail_upload == name:
                raise APIError(503, method, path)
            if self.move_tag_on_upload:
                self.tag = {"type": "commit", "sha": OTHER_COMMIT}
            return copy.deepcopy(self.add_asset(name, data))
        if method == "PATCH" and path == f"{BASE}/releases/7":
            assert data == {"draft": False}
            self.release["draft"] = False
            return copy.deepcopy(self.release)
        raise AssertionError(f"Unexpected request: {method} {path}")


class ReleasePublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "sdk.json").write_text(json.dumps({"name": "tetorica-soundchip-native", "version": "0.1.3"}))
        self.directory = self.root / "releases"
        self.directory.mkdir()
        self.name = "tetorica-soundchip-native-0.1.3-sources.zip"
        self.source = b"deterministic archive fixture"
        self.checksum = f"{hashlib.sha256(self.source).hexdigest()}  {self.name}\n".encode("ascii")
        (self.directory / self.name).write_bytes(self.source)
        (self.directory / "SHA256SUMS").write_bytes(self.checksum)
        self.environment = {"GITHUB_TOKEN": "offline-test-token", "GITHUB_REPOSITORY": "example/tetorica-soundchip-native",
                            "GITHUB_REF": "refs/tags/v0.1.3", "GITHUB_SHA": COMMIT}
        self.api = FakeAPI()

    def run_publish(self):
        return publish(self.root, self.directory, self.environment, self.api)

    def assert_no_writes(self):
        self.assertFalse([call for call in self.api.calls if call[0] in ("POST", "PATCH", "DELETE")])

    def preload(self, draft=True):
        self.api.existing_release(draft)
        self.api.add_asset(self.name, self.source)
        self.api.add_asset("SHA256SUMS", self.checksum)

    def test_create_draft_upload_check_both_assets_then_publish(self):
        self.assertTrue(self.run_publish().endswith("/v0.1.3"))
        writes = [call for call in self.api.calls if call[0] in ("POST", "PATCH")]
        self.assertEqual([call[0] for call in writes], ["POST", "POST", "POST", "PATCH"])
        self.assertTrue(writes[0][2]["draft"])
        self.assertEqual(writes[-1][2], {"draft": False})
        self.assertEqual(writes[1][3], "application/zip")
        self.assertEqual(writes[2][3], "text/plain")
        reads = [call for call in self.api.calls if call[4]]
        self.assertEqual(len(reads), 2)
        self.assertFalse(self.api.release["draft"])

    def test_tag_and_metadata_version_must_match_before_network(self):
        for reference in ("refs/heads/main", "refs/tags/v0.1.2", "refs/tags/0.1.3"):
            with self.subTest(reference=reference):
                self.environment["GITHUB_REF"] = reference
                with self.assertRaisesRegex(ReleaseError, "GITHUB_REF"):
                    self.run_publish()
        self.assertFalse(self.api.calls)

    def test_changed_archive_or_extra_checksum_line_is_rejected_before_network(self):
        (self.directory / self.name).write_bytes(self.source + b"changed")
        with self.assertRaisesRegex(ReleaseError, "SHA256SUMS"):
            self.run_publish()
        (self.directory / self.name).write_bytes(self.source)
        (self.directory / "SHA256SUMS").write_bytes(self.checksum + b"other archive\n")
        with self.assertRaisesRegex(ReleaseError, "SHA256SUMS"):
            self.run_publish()
        self.assertFalse(self.api.calls)

    def test_missing_or_symlinked_inputs_are_rejected(self):
        (self.directory / self.name).unlink()
        with self.assertRaisesRegex(ReleaseError, "Missing regular release file"):
            self.run_publish()
        other = self.root / "elsewhere.zip"
        other.write_bytes(self.source)
        try:
            (self.directory / self.name).symlink_to(other)
        except OSError:
            self.skipTest("Symlink creation unavailable")
        with self.assertRaisesRegex(ReleaseError, "Missing regular release file"):
            self.run_publish()
        self.assertFalse(self.api.calls)

    def test_remote_lightweight_tag_must_match_action_commit(self):
        self.api.tag["sha"] = OTHER_COMMIT
        with self.assertRaisesRegex(ReleaseError, "does not point"):
            self.run_publish()
        self.assert_no_writes()

    def test_annotated_tag_is_peeled_to_expected_commit(self):
        self.api.tag = {"type": "tag", "sha": TAG_OBJECT}
        self.api.tag_objects[TAG_OBJECT] = {"type": "commit", "sha": COMMIT}
        self.run_publish()
        self.assertTrue(any(call[1].endswith(f"/git/tags/{TAG_OBJECT}") for call in self.api.calls))

    def test_wrong_annotated_target_and_tag_cycle_are_rejected(self):
        self.api.tag = {"type": "tag", "sha": TAG_OBJECT}
        for target in ({"type": "commit", "sha": OTHER_COMMIT}, {"type": "tag", "sha": TAG_OBJECT}):
            with self.subTest(target=target):
                self.api.tag_objects[TAG_OBJECT] = target
                with self.assertRaises(ReleaseError):
                    self.run_publish()
        self.assert_no_writes()

    def test_non_not_found_lookup_error_does_not_create_release(self):
        self.api.fail_lookup = 403
        with self.assertRaises(APIError):
            self.run_publish()
        self.assert_no_writes()

    def test_second_upload_failure_keeps_draft_and_retry_reuses_first_asset(self):
        self.api.fail_upload = "SHA256SUMS"
        with self.assertRaises(APIError):
            self.run_publish()
        self.assertTrue(self.api.release["draft"])
        self.assertEqual(set(self.api.assets), {self.name})
        self.assertFalse(any(call[0] == "PATCH" for call in self.api.calls))
        self.api.calls.clear()
        self.api.fail_upload = None
        self.run_publish()
        uploads = [call for call in self.api.calls if call[0] == "POST"]
        self.assertEqual(len(uploads), 1)
        self.assertIn("name=SHA256SUMS", uploads[0][1])
        self.assertFalse(self.api.release["draft"])

    def test_matching_published_release_is_a_read_only_retry(self):
        self.preload(draft=False)
        self.assertTrue(self.run_publish().endswith("/v0.1.3"))
        self.assert_no_writes()

    def test_retry_finds_hidden_draft_through_paginated_release_listing(self):
        self.preload(draft=True)
        self.api.hide_draft_from_tag = True
        self.api.listed_releases_override = [
            {"id": index + 1000, "tag_name": f"v0.0.{index}", "draft": False}
            for index in range(100)
        ] + [self.api.release]
        self.run_publish()
        writes = [call for call in self.api.calls if call[0] in ("POST", "PATCH")]
        self.assertEqual([call[0] for call in writes], ["PATCH"])
        self.assertTrue(any(call[1].endswith("/releases?per_page=100&page=2") for call in self.api.calls))
        self.assertFalse(self.api.release["draft"])

    def test_ambiguous_hidden_drafts_are_rejected_without_writes(self):
        self.preload(draft=True)
        self.api.hide_draft_from_tag = True
        duplicate = {**self.api.release, "id": 8}
        self.api.listed_releases_override = [self.api.release, duplicate]
        with self.assertRaisesRegex(ReleaseError, "Multiple releases"):
            self.run_publish()
        self.assert_no_writes()

    def test_missing_published_asset_is_not_filled_or_replaced(self):
        self.preload(draft=False)
        del self.api.assets["SHA256SUMS"]
        with self.assertRaisesRegex(ReleaseError, "Published release is missing assets"):
            self.run_publish()
        self.assert_no_writes()

    def test_different_same_size_asset_is_never_replaced_in_draft_or_published_release(self):
        for draft in (True, False):
            with self.subTest(draft=draft):
                self.api = FakeAPI()
                self.preload(draft)
                identifier = self.api.assets[self.name]["id"]
                self.api.contents[identifier] = b"X" * len(self.source)
                with self.assertRaisesRegex(ReleaseError, "Existing release asset differs"):
                    self.run_publish()
                self.assert_no_writes()

    def test_tag_move_during_upload_prevents_publication(self):
        self.api.move_tag_on_upload = True
        with self.assertRaisesRegex(ReleaseError, "does not point"):
            self.run_publish()
        self.assertTrue(self.api.release["draft"])
        self.assertFalse(any(call[0] == "PATCH" for call in self.api.calls))

    def test_redirect_removes_token_and_requires_https(self):
        request = Request("https://api.github.com/repos/example/repo/releases/assets/1",
                          headers={"Authorization": "Bearer offline-test-token"})
        handler = SafeRedirect()
        redirected = handler.redirect_request(request, None, 302, "Found", {}, "https://storage.example/asset")
        self.assertFalse(redirected.has_header("Authorization"))
        with self.assertRaisesRegex(ReleaseError, "outside HTTPS"):
            handler.redirect_request(request, None, 302, "Found", {}, "http://storage.example/asset")


if __name__ == "__main__":
    unittest.main()

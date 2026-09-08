from __future__ import annotations

import importlib.util
import json
import tempfile
import types
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "audit.py"
SPEC = importlib.util.spec_from_file_location("migration_audit", MODULE_PATH)
assert SPEC and SPEC.loader
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


class FeedTests(unittest.TestCase):
    def test_preserves_non_permalink_guid_and_encoded_filename(self) -> None:
        feed = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
        <item><title>One</title><link>https://example.test/podcast/one/</link>
        <guid isPermaLink="false">https://example.test/?post_type=one_page_portfolio&amp;p=484</guid>
        <enclosure url="https://media.test/A%20%26%20B.mp3" length="42" type="audio/mpeg" />
        </item></channel></rss>"""
        parsed = audit.parse_feed(feed)
        item = parsed["items"][0]
        self.assertEqual(item["guid"], "https://example.test/?post_type=one_page_portfolio&p=484")
        self.assertIs(item["guidIsPermalink"], False)
        self.assertEqual(audit.normalize_path_from_url(item["enclosure"]["url"]), "A & B.mp3")

    def test_rejects_html(self) -> None:
        with self.assertRaises(audit.AuditError):
            audit.parse_feed(b"<html><body>challenge</body></html>")

    def test_extracts_php_serialized_media_size_and_derivatives(self) -> None:
        self.assertEqual(audit.podpress_media_size('a:1:{s:4:"size";i:12345;}'), 12345)
        metadata = (
            'a:2:{s:4:"file";s:18:"2020/05/original.png";'
            's:5:"sizes";a:1:{s:9:"thumbnail";a:1:{'
            's:4:"file";s:17:"original-150.png";}}}'
        )
        self.assertEqual(
            audit.attachment_derivative_paths("2020/05/original.png", metadata),
            ["2020/05/original-150.png"],
        )


class ValidationTests(unittest.TestCase):
    def valid_documents(self):
        inventory = {
            "formatVersion": 1,
            "summary": {
                "blockingIssueCount": 0,
                "episodesWithTimestamps": 0,
                "timestampedTrackCount": 0,
            },
            "episodes": [
                {
                    "id": "wp-1",
                    "disposition": "migrate",
                    "audioAssetId": "asset-a",
                    "artworkAssetId": "asset-b",
                    "tracklist": {
                        "count": 0,
                        "timestampsAvailable": False,
                        "tracks": [],
                    },
                }
            ],
            "assets": [{"id": "asset-a"}, {"id": "asset-b"}],
            "issues": [],
        }
        legacy = {
            "formatVersion": 1,
            "entries": [{"url": "https://example.test/podcast/one/", "episodeId": "wp-1"}],
        }
        return inventory, legacy

    def test_accepts_consistent_artifacts(self) -> None:
        inventory, legacy = self.valid_documents()
        self.assertEqual(audit.validate_artifacts(inventory, legacy), [])

    def test_rejects_invalid_asset_and_url_targets(self) -> None:
        inventory, legacy = self.valid_documents()
        inventory["episodes"][0]["audioAssetId"] = "missing"
        legacy["entries"][0]["episodeId"] = "wp-99"
        errors = audit.validate_artifacts(inventory, legacy)
        self.assertTrue(any("invalid audioAssetId" in error for error in errors))
        self.assertTrue(any("invalid legacy URL target" in error for error in errors))

    def test_blocker_summary_must_agree(self) -> None:
        inventory, legacy = self.valid_documents()
        inventory["issues"] = [{"id": "M0-X", "blocksMigration": True}]
        errors = audit.validate_artifacts(inventory, legacy)
        self.assertIn("summary blockingIssueCount does not match issues", errors)


class SourceManifestTests(unittest.TestCase):
    def test_rejects_private_output_inside_repository(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            wordpress = root / "wordpress"
            audio = root / "audio"
            uploads = wordpress / "uploads"
            for directory in (wordpress, audio, uploads):
                directory.mkdir(parents=True, exist_ok=True)
            dump = root / "database.sql"
            dump.write_text("-- dump", encoding="utf-8")
            manifest = root / "sources.json"
            manifest.write_text(
                json.dumps(
                    {
                        "snapshotId": "fixture",
                        "capturedAt": "2026-09-07T00:00:00Z",
                        "wordpressRoot": str(wordpress),
                        "databaseDump": str(dump),
                        "audioRoot": str(audio),
                        "artworkDirectories": [str(uploads)],
                        "privateOutputRoot": str(root / "repo" / "private"),
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(audit.AuditError, "outside the public repository"):
                audit.load_sources(manifest, root / "repo")

    def test_accepts_distinct_source_roots_and_rejects_missing_database(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repository = root / "repository"
            wordpress = root / "wordpress-source"
            uploads = wordpress / "wp-content" / "uploads"
            audio = root / "audio-source"
            private = root / "private-evidence"
            for directory in (repository, uploads, audio):
                directory.mkdir(parents=True, exist_ok=True)
            dump = root / "database-source" / "snapshot.sql"
            dump.parent.mkdir()
            dump.write_text("-- dump", encoding="utf-8")
            manifest = root / "sources.json"
            document = {
                "snapshotId": "fixture",
                "capturedAt": "2026-09-07T00:00:00Z",
                "wordpressRoot": {"label": "wp", "path": str(wordpress)},
                "databaseDump": {"label": "db", "path": str(dump)},
                "audioRoot": {"label": "audio", "path": str(audio)},
                "artworkDirectories": [{"label": "uploads", "path": str(uploads)}],
                "privateOutputRoot": str(private),
            }
            manifest.write_text(json.dumps(document), encoding="utf-8")
            loaded = audit.load_sources(manifest, repository)
            self.assertEqual(loaded["audio"], ("audio", audio.resolve()))
            self.assertTrue(private.is_dir())

            dump.unlink()
            with self.assertRaisesRegex(audit.AuditError, "database dump is absent"):
                audit.load_sources(manifest, repository)


class FileEvidenceTests(unittest.TestCase):
    def test_hashes_special_filenames_and_verifies_image_magic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "quotes '&' ünicode.png"
            image.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
            record = audit.file_record("uploads", root, image)
            self.assertEqual(record["relativePath"], "quotes '&' ünicode.png")
            self.assertEqual(record["byteLength"], 15)
            self.assertEqual(audit.image_type(image), "image/png")


class TrackTimingTests(unittest.TestCase):
    def test_derives_alias_matched_starts_and_withholds_duration_mismatch(self) -> None:
        inventory = {
            "formatVersion": 1,
            "sourceSnapshots": {},
            "summary": {},
            "episodes": [
                {
                    "id": "wp-1",
                    "title": "You Don't Know Me",
                    "databaseMedia": {"duration": "00:20"},
                    "tracklist": {
                        "count": 2,
                        "timestampsAvailable": False,
                        "tracks": [
                            {
                                "position": 1,
                                "artist": "One",
                                "title": "First",
                                "startTime": None,
                            },
                            {
                                "position": 2,
                                "artist": "Two",
                                "title": "Second",
                                "startTime": None,
                            },
                        ],
                    },
                },
                {
                    "id": "wp-2",
                    "title": "Praxis",
                    "databaseMedia": {"duration": "00:20"},
                    "tracklist": {
                        "count": 1,
                        "timestampsAvailable": False,
                        "tracks": [
                            {
                                "position": 1,
                                "artist": "Three",
                                "title": "Third",
                                "startTime": None,
                            }
                        ],
                    },
                },
                {
                    "id": "wp-3",
                    "title": "Plush Session",
                    "databaseMedia": {"duration": "00:30"},
                    "tracklist": {
                        "count": 1,
                        "timestampsAvailable": False,
                        "tracks": [
                            {
                                "position": 1,
                                "artist": "Four",
                                "title": "Fourth",
                                "startTime": None,
                            }
                        ],
                    },
                },
            ],
        }
        listing_text = "\n".join(
            [
                "2013-03-20 - Trey Turner - You Don't Know Me Project\\tracked\\01. One - First.flac,10.250000",
                "2013-03-20 - Trey Turner - You Don't Know Me Project\\tracked\\02. Two - Second.flac,9.750000",
                "2015-11-20 - Trey Turner - Praxis\\tracked\\01. Three - Third.flac,5.000000",
                "2009-10-08 - Trey Turner & Cody Haynes - Plush Session\\continuous\\Plush Session.flac,30.000000",
            ]
        )
        with tempfile.TemporaryDirectory() as temporary:
            listing = Path(temporary) / "durations.csv"
            listing.write_text(listing_text, encoding="utf-8")
            evidence = audit.build_track_timing_evidence(inventory, listing)

        statuses = {
            episode["episodeId"]: episode["status"]
            for episode in evidence["episodes"]
        }
        self.assertEqual(statuses["wp-1"], "applied")
        self.assertEqual(statuses["wp-2"], "withheld-duration-mismatch")
        self.assertEqual(statuses["wp-3"], "continuous-only")
        audit.apply_track_timing_evidence(inventory, evidence)
        self.assertEqual(
            [
                track["startTime"]
                for track in inventory["episodes"][0]["tracklist"]["tracks"]
            ],
            [0.0, 10.25],
        )
        self.assertFalse(inventory["episodes"][1]["tracklist"]["timestampsAvailable"])
        self.assertEqual(inventory["summary"]["episodesWithTimestamps"], 1)
        self.assertEqual(inventory["summary"]["timestampedTrackCount"], 2)
        self.assertEqual(audit.validate_track_timing_evidence(inventory, evidence), [])

    def test_validation_rejects_unordered_timestamps(self) -> None:
        inventory, legacy = ValidationTests().valid_documents()
        inventory["episodes"][0]["tracklist"] = {
            "count": 2,
            "timestampsAvailable": True,
            "timestampEvidenceId": "track-timings-test",
            "tracks": [
                {"position": 1, "startTime": 1.0},
                {"position": 2, "startTime": 0.0},
            ],
        }
        inventory["summary"]["episodesWithTimestamps"] = 1
        inventory["summary"]["timestampedTrackCount"] = 2
        errors = audit.validate_artifacts(inventory, legacy)
        self.assertTrue(any("timestamps must start at zero" in error for error in errors))


class CheckCommandTests(unittest.TestCase):
    def test_returns_two_for_valid_artifacts_with_blocker(self) -> None:
        inventory, legacy = ValidationTests().valid_documents()
        inventory["summary"]["blockingIssueCount"] = 1
        inventory["issues"] = [
            {
                "id": "M0-BLOCKER-001",
                "blocksMigration": True,
                "affectedRecords": ["wp-1"],
            }
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory_path = root / "inventory.json"
            legacy_path = root / "legacy.json"
            inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
            legacy_path.write_text(json.dumps(legacy), encoding="utf-8")
            result = audit.check(
                types.SimpleNamespace(
                    inventory=str(inventory_path), legacy_urls=str(legacy_path)
                )
            )
            self.assertEqual(result, 2)


if __name__ == "__main__":
    unittest.main()

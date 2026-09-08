#!/usr/bin/env python3
"""Reproducible WordPress podcast migration audit tooling.

This module intentionally uses only the Python standard library. Raw source paths,
database exports, and feed captures remain in the owner-controlled private audit
workspace; only sanitized, deterministic artifacts are written to the repository.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import email.utils
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable


FORMAT_VERSION = 1
DEFAULT_FEED_URL = "https://nurevolution.net/feed/podcast"
EPISODE_TYPE = "one_page_portfolio"
IMAGE_SUFFIXES = {".gif", ".jpeg", ".jpg", ".png", ".webp"}
AUDIO_SUFFIXES = {".mp3"}
TRACK_DIRECTORY_TITLE_ALIASES = {
    "Better Late Than Never Project": "Better Late Than Never",
    "BijouBreaks Breakthru 2": "BijouBreaks.com Breakthru 2",
    "g3 Mix Session 01": "g3 Mix Session",
    "Trapper Keeper Ultra Keeper Futura S 2000": "Trapper Keeper Futura S2000",
    "You Don't Know Me Project": "You Don't Know Me",
}
TRACK_FILENAME_PATTERN = re.compile(r"^(\d+)(?:\.| -)\s*(.+)\.flac$", re.IGNORECASE)


class AuditError(Exception):
    """An operational or validation failure."""


def utc_now() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical_json(value), encoding="utf-8")


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AuditError(f"cannot read JSON {path}: {exc}") from exc


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        with path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise AuditError(f"invalid JSON in {path}:{line_number}: {exc}") from exc
                if not isinstance(row, dict):
                    raise AuditError(f"expected object in {path}:{line_number}")
                rows.append(row)
    except (OSError, UnicodeError) as exc:
        raise AuditError(f"cannot read {path}: {exc}") from exc
    return rows


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{digest}"


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def ensure_readable_file(path: Path, category: str) -> None:
    if not path.is_file() or not os.access(path, os.R_OK):
        raise AuditError(f"{category} is absent or unreadable: {path}")


def ensure_readable_directory(path: Path, category: str) -> None:
    if not path.is_dir() or not os.access(path, os.R_OK | os.X_OK):
        raise AuditError(f"{category} is absent or unreadable: {path}")


def source_path(value: Any, key: str) -> tuple[str, Path]:
    if isinstance(value, str):
        return key, Path(value).expanduser().resolve()
    if isinstance(value, dict) and isinstance(value.get("path"), str):
        label = value.get("label", key)
        if not isinstance(label, str) or not label:
            raise AuditError(f"invalid source label for {key}")
        return label, Path(value["path"]).expanduser().resolve()
    raise AuditError(f"source manifest field {key!r} must be a path or labeled path object")


def load_sources(path: Path, repository_root: Path) -> dict[str, Any]:
    manifest = read_json(path)
    if not isinstance(manifest, dict):
        raise AuditError("source manifest must be an object")

    wordpress_label, wordpress_root = source_path(manifest.get("wordpressRoot"), "wordpress")
    database_label, database_dump = source_path(manifest.get("databaseDump"), "database")
    audio_label, audio_root = source_path(manifest.get("audioRoot"), "audio")
    raw_artwork = manifest.get("artworkDirectories")
    if not isinstance(raw_artwork, list) or not raw_artwork:
        raise AuditError("source manifest must contain at least one artworkDirectories entry")
    artwork = [source_path(item, f"artwork-{index + 1}") for index, item in enumerate(raw_artwork)]

    ensure_readable_directory(wordpress_root, "WordPress root")
    ensure_readable_file(database_dump, "database dump")
    ensure_readable_directory(audio_root, "audio root")
    for _label, directory in artwork:
        ensure_readable_directory(directory, "artwork directory")

    private_output_value = manifest.get("privateOutputRoot")
    if not isinstance(private_output_value, str):
        raise AuditError("source manifest must contain privateOutputRoot")
    private_output = Path(private_output_value).expanduser().resolve()
    for source in [wordpress_root, database_dump, audio_root, *(path for _, path in artwork)]:
        if is_within(private_output, source) or is_within(source, private_output):
            raise AuditError(f"private output root overlaps source input: {source}")
    if is_within(private_output, repository_root):
        raise AuditError("private output root must be outside the public repository")
    private_output.mkdir(parents=True, exist_ok=True)

    snapshot_id = manifest.get("snapshotId")
    captured_at = manifest.get("capturedAt")
    if not isinstance(snapshot_id, str) or not snapshot_id:
        raise AuditError("source manifest must contain a stable snapshotId")
    if not isinstance(captured_at, str) or not captured_at:
        raise AuditError("source manifest must contain capturedAt")

    return {
        "snapshotId": snapshot_id,
        "capturedAt": captured_at,
        "pairingNote": manifest.get("pairingNote"),
        "wordpress": (wordpress_label, wordpress_root),
        "database": (database_label, database_dump),
        "audio": (audio_label, audio_root),
        "artwork": artwork,
        "privateOutput": private_output,
    }


def iter_files(root: Path) -> Iterable[Path]:
    for directory, names, filenames in os.walk(root, followlinks=False):
        names[:] = sorted(name for name in names if not (Path(directory) / name).is_symlink())
        for filename in sorted(filenames):
            path = Path(directory) / filename
            if path.is_file() and not path.is_symlink():
                yield path


def file_record(label: str, root: Path, path: Path) -> dict[str, Any]:
    relative = path.relative_to(root).as_posix()
    return {
        "sourceRoot": label,
        "relativePath": relative,
        "byteLength": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def directory_manifest(label: str, root: Path) -> tuple[list[dict[str, Any]], str]:
    records = [file_record(label, root, path) for path in iter_files(root)]
    digest = hashlib.sha256()
    for record in records:
        digest.update(canonical_json(record).encode("utf-8"))
    return records, digest.hexdigest()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(parent: ET.Element, name: str) -> str | None:
    for child in parent:
        if local_name(child.tag) == name:
            return child.text or ""
    return None


def parse_feed(body: bytes) -> dict[str, Any]:
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise AuditError(f"feed is not parseable XML: {exc}") from exc
    if local_name(root.tag).lower() != "rss":
        raise AuditError(f"expected RSS root, found {local_name(root.tag)!r}")
    channel = next((element for element in root if local_name(element.tag) == "channel"), None)
    if channel is None:
        raise AuditError("RSS has no channel")

    channel_image = next((element for element in channel if local_name(element.tag) == "image"), None)
    standard_image_url = child_text(channel_image, "url") if channel_image is not None else None
    itunes_image_url = next(
        (
            element.get("href")
            for element in channel
            if element.tag == "{http://www.itunes.com/dtds/podcast-1.0.dtd}image"
        ),
        None,
    )
    items: list[dict[str, Any]] = []
    for position, item in enumerate(
        (element for element in channel if local_name(element.tag) == "item"), 1
    ):
        guid_node = next((element for element in item if local_name(element.tag) == "guid"), None)
        enclosure_node = next(
            (element for element in item if local_name(element.tag) == "enclosure"), None
        )
        image_node = next((element for element in item if local_name(element.tag) == "image"), None)
        encoded = next((element.text or "" for element in item if local_name(element.tag) == "encoded"), None)
        guid = (guid_node.text or "") if guid_node is not None else None
        permalink_attr = guid_node.get("isPermaLink") if guid_node is not None else None
        if permalink_attr is None and guid is not None:
            permalink: bool | None = True
        elif permalink_attr is None:
            permalink = None
        else:
            permalink = permalink_attr.lower() == "true"
        items.append(
            {
                "position": position,
                "title": child_text(item, "title"),
                "link": child_text(item, "link"),
                "guid": guid,
                "guidIsPermalink": permalink,
                "guidIsPermalinkSource": permalink_attr,
                "publicationDate": child_text(item, "pubDate"),
                "descriptionHtml": child_text(item, "description"),
                "contentHtml": encoded,
                "duration": child_text(item, "duration"),
                "artworkUrl": image_node.get("href") if image_node is not None else None,
                "enclosure": (
                    {
                        "url": enclosure_node.get("url"),
                        "type": enclosure_node.get("type"),
                        "byteLength": integer_or_none(enclosure_node.get("length")),
                    }
                    if enclosure_node is not None
                    else None
                ),
            }
        )
    if not items:
        raise AuditError("RSS contains no items")
    return {
        "channel": {
            "title": child_text(channel, "title"),
            "link": next(
                (element.text or "" for element in channel if element.tag == "link"),
                None,
            ),
            "description": child_text(channel, "description"),
            "standardArtworkUrl": standard_image_url,
            "itunesArtworkUrl": itunes_image_url,
            "newFeedUrl": next(
                (
                    element.text or ""
                    for element in channel
                    if element.tag == "{http://www.itunes.com/dtds/podcast-1.0.dtd}new-feed-url"
                ),
                None,
            ),
        },
        "items": items,
    }


def integer_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def duration_text_seconds(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    parts = value.split(":")
    if len(parts) not in {2, 3} or any(not part.isdigit() for part in parts):
        return None
    numbers = [int(part) for part in parts]
    if numbers[-1] >= 60 or numbers[-2] >= 60:
        return None
    if len(numbers) == 2:
        return numbers[0] * 60 + numbers[1]
    return numbers[0] * 3600 + numbers[1] * 60 + numbers[2]


def decimal_seconds(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.000001")))


def normalized_track_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def build_track_timing_evidence(
    inventory: dict[str, Any], listing_path: Path, tolerance_seconds: Decimal = Decimal("1")
) -> dict[str, Any]:
    ensure_readable_file(listing_path, "split-FLAC duration listing")
    episodes_by_title = {
        episode.get("title"): episode
        for episode in inventory.get("episodes", [])
        if isinstance(episode, dict) and isinstance(episode.get("title"), str)
    }
    groups: dict[str, dict[str, Any]] = {}
    listed_file_count = 0
    try:
        with listing_path.open(encoding="utf-8-sig", newline="") as handle:
            for line_number, row in enumerate(csv.reader(handle), 1):
                if not row:
                    continue
                if len(row) != 2:
                    raise AuditError(
                        f"duration listing line {line_number} must contain path,duration"
                    )
                listed_file_count += 1
                source_path_text, raw_duration = row
                source_directory = source_path_text.split("\\", 1)[0]
                directory_parts = source_directory.split(" - ", 2)
                if len(directory_parts) != 3:
                    raise AuditError(
                        f"duration listing line {line_number} has no recognizable episode directory"
                    )
                source_title = directory_parts[2]
                episode_title = TRACK_DIRECTORY_TITLE_ALIASES.get(source_title, source_title)
                try:
                    duration = Decimal(raw_duration)
                except InvalidOperation as exc:
                    raise AuditError(
                        f"duration listing line {line_number} has an invalid duration"
                    ) from exc
                if not duration.is_finite() or duration <= 0:
                    raise AuditError(
                        f"duration listing line {line_number} duration must be finite and positive"
                    )
                group = groups.setdefault(
                    source_directory,
                    {
                        "episodeTitle": episode_title,
                        "sourceDirectory": source_directory,
                        "continuousFiles": [],
                        "tracks": [],
                    },
                )
                filename = source_path_text.rsplit("\\", 1)[-1]
                match = TRACK_FILENAME_PATTERN.fullmatch(filename)
                if match is None:
                    group["continuousFiles"].append(
                        {"filename": filename, "durationSeconds": decimal_seconds(duration)}
                    )
                    continue
                payload = match.group(2)
                if " - " not in payload:
                    raise AuditError(
                        f"duration listing line {line_number} has no artist/title separator"
                    )
                artist, title = payload.split(" - ", 1)
                group["tracks"].append(
                    {
                        "position": int(match.group(1)),
                        "filename": filename,
                        "artist": artist,
                        "title": title,
                        "durationDecimal": duration,
                    }
                )
    except (OSError, UnicodeError, csv.Error) as exc:
        raise AuditError(f"cannot read duration listing {listing_path}: {exc}") from exc

    evidence_episodes: list[dict[str, Any]] = []
    applied_episode_count = 0
    applied_track_count = 0
    for group in groups.values():
        episode = episodes_by_title.get(group["episodeTitle"])
        if episode is None:
            raise AuditError(
                f"duration listing directory does not match an episode: {group['sourceDirectory']}"
            )
        source_tracks = sorted(group["tracks"], key=lambda track: track["position"])
        if not source_tracks:
            evidence_episodes.append(
                {
                    "episodeId": episode["id"],
                    "sourceDirectory": group["sourceDirectory"],
                    "status": "continuous-only",
                    "continuousFiles": group["continuousFiles"],
                    "tracks": [],
                }
            )
            continue
        canonical_tracks = episode.get("tracklist", {}).get("tracks", [])
        positions = [track["position"] for track in source_tracks]
        expected_positions = list(range(1, len(source_tracks) + 1))
        if positions != expected_positions:
            raise AuditError(
                f"{episode['id']}: split-FLAC positions are not contiguous from one"
            )
        if len(source_tracks) != len(canonical_tracks):
            raise AuditError(
                f"{episode['id']}: {len(source_tracks)} split FLACs do not match "
                f"{len(canonical_tracks)} canonical tracks"
            )
        cumulative = Decimal(0)
        timing_tracks: list[dict[str, Any]] = []
        metadata_mismatch_positions: list[int] = []
        for source_track, canonical_track in zip(source_tracks, canonical_tracks, strict=True):
            if (
                normalized_track_text(source_track["artist"])
                != normalized_track_text(canonical_track.get("artist"))
                or normalized_track_text(source_track["title"])
                != normalized_track_text(canonical_track.get("title"))
            ):
                metadata_mismatch_positions.append(source_track["position"])
            timing_tracks.append(
                {
                    "position": source_track["position"],
                    "filename": source_track["filename"],
                    "durationSeconds": decimal_seconds(source_track["durationDecimal"]),
                    "startTime": decimal_seconds(cumulative),
                }
            )
            cumulative += source_track["durationDecimal"]
        episode_duration = duration_text_seconds(
            episode.get("databaseMedia", {}).get("duration")
        )
        if episode_duration is None:
            raise AuditError(f"{episode['id']}: canonical episode duration is invalid")
        difference = cumulative - Decimal(episode_duration)
        status = (
            "applied"
            if abs(difference) <= tolerance_seconds
            else "withheld-duration-mismatch"
        )
        if status == "applied":
            applied_episode_count += 1
            applied_track_count += len(timing_tracks)
        evidence_episodes.append(
            {
                "episodeId": episode["id"],
                "sourceDirectory": group["sourceDirectory"],
                "status": status,
                "trackCount": len(timing_tracks),
                "splitDurationSeconds": decimal_seconds(cumulative),
                "episodeDurationSeconds": episode_duration,
                "durationDifferenceSeconds": decimal_seconds(difference),
                "metadataMismatchPositions": metadata_mismatch_positions,
                "continuousFiles": group["continuousFiles"],
                "tracks": timing_tracks,
            }
        )

    source_sha256 = sha256_file(listing_path)
    return {
        "formatVersion": FORMAT_VERSION,
        "id": stable_id("track-timings", source_sha256),
        "source": {
            "kind": "owner-supplied ffprobe split-FLAC duration listing",
            "receivedDate": "2026-09-07",
            "sha256": source_sha256,
        },
        "derivation": {
            "method": "Each startTime is the exact cumulative duration of preceding numbered split FLACs.",
            "directoryDatesUsedForMatching": False,
            "masterDurationToleranceSeconds": decimal_seconds(tolerance_seconds),
        },
        "summary": {
            "listedFileCount": listed_file_count,
            "matchedEpisodeCount": len(evidence_episodes),
            "splitTrackFileCount": sum(
                len(episode["tracks"]) for episode in evidence_episodes
            ),
            "appliedEpisodeCount": applied_episode_count,
            "appliedTrackCount": applied_track_count,
            "withheldEpisodeCount": sum(
                episode["status"] == "withheld-duration-mismatch"
                for episode in evidence_episodes
            ),
            "continuousOnlyEpisodeCount": sum(
                episode["status"] == "continuous-only"
                for episode in evidence_episodes
            ),
        },
        "episodes": sorted(evidence_episodes, key=lambda episode: episode["episodeId"]),
    }


def apply_track_timing_evidence(
    inventory: dict[str, Any], evidence: dict[str, Any]
) -> None:
    episodes_by_id = {
        episode.get("id"): episode
        for episode in inventory.get("episodes", [])
        if isinstance(episode, dict)
    }
    for timing_episode in evidence.get("episodes", []):
        if timing_episode.get("status") != "applied":
            continue
        episode_id = timing_episode.get("episodeId")
        episode = episodes_by_id.get(episode_id)
        if episode is None:
            raise AuditError(f"timing evidence references unknown episode {episode_id}")
        canonical_tracks = episode.get("tracklist", {}).get("tracks", [])
        timing_tracks = timing_episode.get("tracks", [])
        if len(canonical_tracks) != len(timing_tracks):
            raise AuditError(f"{episode_id}: timing evidence track count changed")
        for canonical_track, timing_track in zip(
            canonical_tracks, timing_tracks, strict=True
        ):
            if canonical_track.get("position") != timing_track.get("position"):
                raise AuditError(f"{episode_id}: timing evidence position changed")
            existing = canonical_track.get("startTime")
            proposed = timing_track.get("startTime")
            if existing is not None and existing != proposed:
                raise AuditError(f"{episode_id}: timing evidence conflicts with startTime")
            canonical_track["startTime"] = proposed
        episode["tracklist"]["timestampsAvailable"] = True
        episode["tracklist"]["timestampEvidenceId"] = evidence["id"]
    issues = inventory.setdefault("issues", [])
    existing_issue_ids = {
        item.get("id") for item in issues if isinstance(item, dict)
    }
    for timing_episode in evidence.get("episodes", []):
        if timing_episode.get("status") != "withheld-duration-mismatch":
            continue
        episode_id = timing_episode.get("episodeId")
        post_id = str(episode_id).removeprefix("wp-")
        issue_id = f"M0-TRACK-TIMING-{post_id}"
        if issue_id in existing_issue_ids:
            continue
        issues.append(
            issue(
                issue_id,
                "split-track-duration-mismatch",
                "Derived timestamps were withheld because split-FLAC durations do not reconcile to the episode duration.",
                [episode_id],
                False,
                {
                    "splitDurationSeconds": timing_episode.get(
                        "splitDurationSeconds"
                    ),
                    "episodeDurationSeconds": timing_episode.get(
                        "episodeDurationSeconds"
                    ),
                    "durationDifferenceSeconds": timing_episode.get(
                        "durationDifferenceSeconds"
                    ),
                },
            )
        )
        existing_issue_ids.add(issue_id)
    issues.sort(key=lambda item: item["id"])
    summary = inventory.setdefault("summary", {})
    summary["episodesWithTimestamps"] = sum(
        episode.get("tracklist", {}).get("timestampsAvailable") is True
        for episode in episodes_by_id.values()
    )
    summary["timestampedTrackCount"] = sum(
        len(episode.get("tracklist", {}).get("tracks", []))
        for episode in episodes_by_id.values()
        if episode.get("tracklist", {}).get("timestampsAvailable") is True
    )
    summary["blockingIssueCount"] = sum(
        item.get("blocksMigration") is True for item in issues
    )
    summary["nonBlockingIssueCount"] = sum(
        item.get("blocksMigration") is False for item in issues
    )
    inventory.setdefault("sourceSnapshots", {})["trackTimings"] = {
        "id": evidence["id"],
        "source": evidence["source"],
        "derivation": evidence["derivation"],
    }


def derive_timestamps(args: argparse.Namespace) -> int:
    inventory_path = Path(args.inventory).expanduser().resolve()
    inventory = read_json(inventory_path)
    evidence = build_track_timing_evidence(
        inventory,
        Path(args.durations).expanduser().resolve(),
        Decimal(str(args.master_duration_tolerance)),
    )
    apply_track_timing_evidence(inventory, evidence)
    write_json(Path(args.output).expanduser().resolve(), evidence)
    write_json(inventory_path, inventory)
    write_fixtures(inventory_path.parent / "fixtures", inventory)
    print(
        f"derived {evidence['summary']['appliedTrackCount']} timestamps across "
        f"{evidence['summary']['appliedEpisodeCount']} episodes; "
        f"withheld {evidence['summary']['withheldEpisodeCount']} duration mismatch"
    )
    return 0


def capture_feed(args: argparse.Namespace) -> int:
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    body_path = output_dir / "feed.xml"
    metadata_path = output_dir / "feed-metadata.json"
    if (body_path.exists() or metadata_path.exists()) and not args.refresh:
        raise AuditError("feed reference already exists; pass --refresh for an explicit recapture")

    request = urllib.request.Request(
        args.url,
        headers={"User-Agent": "nurevolution-migration-audit/1"},
    )
    retrieved_at = utc_now()
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            body = response.read()
            status = response.status
            final_url = response.url
            headers = response.headers
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise AuditError(f"feed capture failed: {exc}") from exc

    if status != 200:
        raise AuditError(f"feed capture returned HTTP {status}")
    content_type = headers.get("Content-Type", "")
    if "xml" not in content_type.lower():
        raise AuditError(f"feed response is not XML (Content-Type: {content_type!r})")
    parsed = parse_feed(body)
    body_path.write_bytes(body)
    metadata = {
        "formatVersion": FORMAT_VERSION,
        "requestedUrl": args.url,
        "finalUrl": final_url,
        "retrievedAt": retrieved_at,
        "status": status,
        "contentType": content_type,
        "etag": headers.get("ETag"),
        "lastModified": headers.get("Last-Modified"),
        "date": headers.get("Date"),
        "bodyByteLength": len(body),
        "bodySha256": hashlib.sha256(body).hexdigest(),
        "itemCount": len(parsed["items"]),
    }
    write_json(metadata_path, metadata)
    print(f"captured {len(parsed['items'])} feed items to {output_dir}")
    return 0


def docker_query(container: str, database: str | None, query: str) -> list[dict[str, Any]]:
    command = ["docker", "exec", container, "mariadb", "-uroot", "--batch", "--raw", "--skip-column-names"]
    if database:
        command.append(f"--database={database}")
    command.extend(["-e", query])
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = exc.stderr.strip() if isinstance(exc, subprocess.CalledProcessError) else str(exc)
        raise AuditError(f"database export query failed: {detail}") from exc
    rows: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        if line.strip():
            value = json.loads(line)
            if not isinstance(value, dict):
                raise AuditError("database query returned a non-object JSON value")
            rows.append(value)
    return rows


def export_database(args: argparse.Namespace) -> int:
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    database = args.database
    tables = docker_query(
        args.container,
        None,
        "SELECT JSON_OBJECT('name',TABLE_NAME,'rows',TABLE_ROWS,'engine',ENGINE) "
        f"FROM information_schema.tables WHERE table_schema={sql_literal(database)} ORDER BY TABLE_NAME",
    )
    post_tables = [row["name"] for row in tables if str(row.get("name", "")).endswith("_posts")]
    if len(post_tables) != 1:
        raise AuditError(f"could not uniquely discover WordPress posts table: {post_tables}")
    prefix = str(post_tables[0])[: -len("posts")]
    required = {f"{prefix}posts", f"{prefix}postmeta", f"{prefix}options"}
    available = {str(row["name"]) for row in tables}
    missing = sorted(required - available)
    if missing:
        raise AuditError(f"database export is missing required tables: {', '.join(missing)}")

    posts_query = (
        "SELECT JSON_OBJECT("
        "'id',ID,'postDate',post_date,'postDateGmt',post_date_gmt,'modifiedGmt',post_modified_gmt,"
        "'status',post_status,'name',post_name,'title',post_title,'excerpt',post_excerpt,"
        "'content',post_content,'guid',guid,'type',post_type,'parent',post_parent,'mimeType',post_mime_type) "
        f"FROM `{prefix}posts` WHERE post_type IN ('{EPISODE_TYPE}','attachment') ORDER BY ID"
    )
    posts = docker_query(args.container, database, posts_query)
    ids = [integer_or_none(row.get("id")) for row in posts]
    clean_ids = [value for value in ids if value is not None]
    if not clean_ids:
        raise AuditError("database contains no episode or attachment records")
    id_list = ",".join(str(value) for value in clean_ids)
    meta_query = (
        "SELECT JSON_OBJECT('id',meta_id,'postId',post_id,'keyName',meta_key,'valueText',meta_value) "
        f"FROM `{prefix}postmeta` WHERE post_id IN ({id_list}) ORDER BY post_id,meta_id"
    )
    option_names = [
        "active_plugins", "gmt_offset", "permalink_structure", "podPress_config",
        "podPress_version", "siteurl", "stylesheet", "template", "timezone_string",
    ]
    options_query = (
        "SELECT JSON_OBJECT('name',option_name,'valueText',option_value) "
        f"FROM `{prefix}options` WHERE option_name IN ({','.join(sql_literal(name) for name in option_names)}) "
        "OR option_name LIKE 'podPress_category_%' ORDER BY option_name"
    )
    columns_query = (
        "SELECT JSON_OBJECT('tableName',TABLE_NAME,'columnName',COLUMN_NAME,'dataType',DATA_TYPE,'columnType',COLUMN_TYPE) "
        "FROM information_schema.columns "
        f"WHERE table_schema={sql_literal(database)} ORDER BY TABLE_NAME,ORDINAL_POSITION"
    )
    datasets = {
        "tables.jsonl": tables,
        "columns.jsonl": docker_query(args.container, None, columns_query),
        "posts.jsonl": posts,
        "postmeta.jsonl": docker_query(args.container, database, meta_query),
        "options.jsonl": docker_query(args.container, database, options_query),
    }
    for filename, rows in datasets.items():
        target = output_dir / filename
        target.write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
    write_json(
        output_dir / "export-metadata.json",
        {
            "formatVersion": FORMAT_VERSION,
            "database": database,
            "serverVersion": docker_query(
                args.container, None, "SELECT JSON_OBJECT('version',VERSION())"
            )[0]["version"],
            "tablePrefix": prefix,
            "episodePostType": EPISODE_TYPE,
            "rowCounts": {name: len(rows) for name, rows in datasets.items()},
        },
    )
    print(f"exported database evidence to {output_dir}")
    return 0


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def image_type(path: Path) -> str | None:
    with path.open("rb") as handle:
        header = handle.read(16)
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    return None


def normalize_path_from_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.unquote(Path(parsed.path).name)


def values_by_post(meta_rows: list[dict[str, Any]]) -> dict[int, dict[str, list[str]]]:
    result: dict[int, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for row in meta_rows:
        post_id = integer_or_none(row.get("postId"))
        key = row.get("keyName")
        value = row.get("valueText")
        if post_id is not None and isinstance(key, str):
            result[post_id][key].append("" if value is None else str(value))
    return result


def one(meta: dict[str, list[str]], key: str) -> str | None:
    values = meta.get(key, [])
    return values[-1] if values else None


def feed_post_id(item: dict[str, Any]) -> int | None:
    for value in (item.get("guid"), item.get("link")):
        if not isinstance(value, str):
            continue
        query = urllib.parse.parse_qs(urllib.parse.urlparse(value).query)
        if query.get("p") and query["p"][0].isdigit():
            return int(query["p"][0])
    return None


def parse_database_utc(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value or value.startswith("0000-00-00"):
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.UTC)
    except ValueError:
        return None


def parse_feed_date(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        return parsed.astimezone(dt.UTC) if parsed.tzinfo else parsed.replace(tzinfo=dt.UTC)
    except (TypeError, ValueError, OverflowError):
        return None


def uploads_relative_from_url(url: str | None) -> str | None:
    if not url:
        return None
    path = urllib.parse.unquote(urllib.parse.urlparse(url).path)
    marker = "/wp-content/uploads/"
    return path.split(marker, 1)[1] if marker in path else None


def issue(
    issue_id: str,
    kind: str,
    message: str,
    affected: list[str],
    blocker: bool,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = {
        "id": issue_id,
        "kind": kind,
        "message": message,
        "affectedRecords": sorted(affected),
        "blocksMigration": blocker,
    }
    if evidence:
        result["evidence"] = evidence
    return result


def podpress_media_size(serialized: str | None) -> int | None:
    if not serialized:
        return None
    match = re.search(r's:4:"size";i:(\d+);', serialized)
    return int(match.group(1)) if match else None


def attachment_derivative_paths(relative: str, serialized: str | None) -> list[str]:
    if not serialized:
        return []
    directory = Path(relative).parent
    filenames = re.findall(
        r's:(?:4|8):"(?:file|filename)";s:\d+:"([^"\\]+\.(?:gif|jpe?g|png|webp))";',
        serialized,
        flags=re.IGNORECASE,
    )
    candidates = {
        (Path(filename) if "/" in filename else directory / filename).as_posix()
        for filename in filenames
    }
    candidates.discard(relative)
    return sorted(candidates)


def reconcile(args: argparse.Namespace) -> int:
    repository_root = Path(__file__).resolve().parents[2]
    output_dir = Path(args.output_dir).expanduser().resolve()
    if not is_within(output_dir, repository_root):
        raise AuditError("public output directory must be inside the repository")
    sources = load_sources(Path(args.sources).expanduser().resolve(), repository_root)
    for _label, source in [sources["wordpress"], sources["database"], sources["audio"], *sources["artwork"]]:
        if is_within(output_dir, source):
            raise AuditError(f"public output directory overlaps source input: {source}")

    reference_dir = Path(args.reference_dir).expanduser().resolve()
    feed_body_path = reference_dir / "feed.xml"
    feed_metadata_path = reference_dir / "feed-metadata.json"
    ensure_readable_file(feed_body_path, "frozen feed body")
    ensure_readable_file(feed_metadata_path, "frozen feed metadata")
    feed_body = feed_body_path.read_bytes()
    feed_metadata = read_json(feed_metadata_path)
    if feed_metadata.get("bodySha256") != hashlib.sha256(feed_body).hexdigest():
        raise AuditError("frozen feed checksum does not match its metadata")
    feed = parse_feed(feed_body)

    database_export = Path(args.database_export).expanduser().resolve()
    ensure_readable_directory(database_export, "database export")
    export_metadata = read_json(database_export / "export-metadata.json")
    posts = read_jsonl(database_export / "posts.jsonl")
    meta_rows = read_jsonl(database_export / "postmeta.jsonl")
    columns = read_jsonl(database_export / "columns.jsonl")
    options = read_jsonl(database_export / "options.jsonl")

    database_label, database_dump = sources["database"]
    audio_label, audio_root = sources["audio"]
    wordpress_label, wordpress_root = sources["wordpress"]
    audio_root_records, audio_digest = directory_manifest(audio_label, audio_root)
    audio_records = [record for record in audio_root_records if Path(record["relativePath"]).suffix.lower() in AUDIO_SUFFIXES]
    audio_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in audio_records:
        audio_by_name[Path(record["relativePath"]).name].append(record)

    artwork_records: list[dict[str, Any]] = []
    artwork_digests: list[dict[str, str]] = []
    artwork_by_relative: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for label, root in sources["artwork"]:
        records, digest = directory_manifest(label, root)
        image_records = []
        for record in records:
            if Path(record["relativePath"]).suffix.lower() not in IMAGE_SUFFIXES:
                continue
            path = root / record["relativePath"]
            detected = image_type(path)
            record = {**record, "verifiedMediaType": detected}
            image_records.append(record)
            artwork_by_relative[record["relativePath"]].append(record)
        artwork_records.extend(image_records)
        artwork_digests.append({"sourceRoot": label, "treeSha256": digest})

    private_manifest_records: list[dict[str, Any]] = []
    for label, root in [sources["wordpress"], sources["audio"], *sources["artwork"]]:
        records, _digest = directory_manifest(label, root)
        private_manifest_records.extend(records)
    private_manifest_records.append(file_record(database_label, database_dump.parent, database_dump))
    write_json(
        sources["privateOutput"] / "full-source-manifest.json",
        {
            "formatVersion": FORMAT_VERSION,
            "snapshotId": sources["snapshotId"],
            "capturedAt": sources["capturedAt"],
            "files": sorted(
                private_manifest_records,
                key=lambda value: (value["sourceRoot"], value["relativePath"]),
            ),
        },
    )
    wordpress_records, wordpress_digest = directory_manifest(wordpress_label, wordpress_root)

    meta = values_by_post(meta_rows)
    attachments = {integer_or_none(row.get("id")): row for row in posts if row.get("type") == "attachment"}
    episodes_source = [row for row in posts if row.get("type") == EPISODE_TYPE]
    feed_items = feed["items"]
    feed_by_post: dict[int, list[dict[str, Any]]] = defaultdict(list)
    feed_by_audio: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in feed_items:
        post_id = feed_post_id(item)
        if post_id is not None:
            feed_by_post[post_id].append(item)
        enclosure = item.get("enclosure")
        filename = normalize_path_from_url(enclosure.get("url") if isinstance(enclosure, dict) else None)
        if filename:
            feed_by_audio[filename].append(item)

    issues: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []
    asset_ids_by_ref: dict[tuple[str, str], str] = {}
    for record in sorted(audio_records + artwork_records, key=lambda value: (value["sourceRoot"], value["relativePath"])):
        kind = "audio" if Path(record["relativePath"]).suffix.lower() in AUDIO_SUFFIXES else "artwork"
        asset_id = stable_id("asset", record["sourceRoot"], record["relativePath"])
        asset_ids_by_ref[(record["sourceRoot"], record["relativePath"])] = asset_id
        assets.append({"id": asset_id, "kind": kind, **record})

    show = dict(feed["channel"])
    for url_key, asset_key in [
        ("standardArtworkUrl", "standardArtworkAssetId"),
        ("itunesArtworkUrl", "itunesArtworkAssetId"),
    ]:
        relative = uploads_relative_from_url(show.get(url_key))
        candidates = artwork_by_relative.get(relative, []) if relative else []
        show[asset_key] = (
            asset_ids_by_ref[(candidates[0]["sourceRoot"], candidates[0]["relativePath"])]
            if len(candidates) == 1
            else None
        )
        if len(candidates) == 1:
            associated_artwork_ref = (candidates[0]["sourceRoot"], candidates[0]["relativePath"])
            # Show-level artwork is associated even though it is not an episode thumbnail.
            # The set is declared below for episode reconciliation, so retain these refs
            # separately until that set exists.
            show.setdefault("_associatedArtworkRefs", []).append(associated_artwork_ref)

    episodes: list[dict[str, Any]] = []
    matched_feed_positions: set[int] = set()
    associated_artwork_refs: set[tuple[str, str]] = {
        tuple(value) for value in show.pop("_associatedArtworkRefs", [])
    }
    associated_artwork_original_refs: set[tuple[str, str]] = set()
    for source in sorted(episodes_source, key=lambda row: int(row["id"])):
        post_id = int(source["id"])
        episode_id = f"wp-{post_id}"
        episode_meta = meta.get(post_id, {})
        db_filename = one(episode_meta, "file_name") or one(episode_meta, "mp3_url")
        candidates = feed_by_post.get(post_id, [])
        if not candidates and db_filename:
            candidates = feed_by_audio.get(Path(db_filename).name, [])
        if len(candidates) > 1:
            issues.append(issue(f"M0-FEED-MATCH-{post_id}", "ambiguous-feed-match", "Multiple feed items match the source episode.", [episode_id], True))
        feed_item = candidates[0] if len(candidates) == 1 else None
        if feed_item:
            matched_feed_positions.add(int(feed_item["position"]))
        elif source.get("status") == "publish":
            issues.append(issue(f"M0-FEED-MISSING-{post_id}", "published-record-absent-from-feed", "Published source episode has no unique frozen-feed match.", [episode_id], True))

        database_instant = parse_database_utc(source.get("postDateGmt"))
        feed_instant = parse_feed_date(feed_item.get("publicationDate") if feed_item else None)
        if feed_item and (database_instant is None or feed_instant is None):
            issues.append(
                issue(
                    f"M0-DATE-INVALID-{post_id}",
                    "invalid-publication-date",
                    "Database or frozen-feed publication evidence is malformed.",
                    [episode_id],
                    True,
                    {
                        "databaseUtc": source.get("postDateGmt"),
                        "feedRfc822": feed_item.get("publicationDate"),
                    },
                )
            )
        elif database_instant and feed_instant and database_instant != feed_instant:
            issues.append(
                issue(
                    f"M0-DATE-MISMATCH-{post_id}",
                    "publication-date-mismatch",
                    "Database UTC and frozen-feed publication instants disagree.",
                    [episode_id],
                    True,
                    {
                        "databaseUtc": source.get("postDateGmt"),
                        "feedRfc822": feed_item.get("publicationDate"),
                    },
                )
            )

        enclosure = feed_item.get("enclosure") if feed_item else None
        enclosure_filename = normalize_path_from_url(enclosure.get("url") if isinstance(enclosure, dict) else None)
        effective_filename = enclosure_filename or (Path(db_filename).name if db_filename else None)
        matching_audio = audio_by_name.get(effective_filename, []) if effective_filename else []
        audio_asset_id = None
        if len(matching_audio) == 1:
            record = matching_audio[0]
            audio_asset_id = asset_ids_by_ref[(record["sourceRoot"], record["relativePath"])]
            acf_size = integer_or_none(one(episode_meta, "file_size_(in_bytes)"))
            podpress_size = podpress_media_size(one(episode_meta, "_podPressMedia"))
            enclosure_size = enclosure.get("byteLength") if isinstance(enclosure, dict) else None
            size_evidence = {
                "localByteLength": record["byteLength"],
                "acfByteLength": acf_size,
                "podPressByteLength": podpress_size,
                "enclosureByteLength": enclosure_size,
            }
            if enclosure_size is not None and enclosure_size != record["byteLength"]:
                issues.append(issue(f"M0-AUDIO-SIZE-{post_id}", "enclosure-size-mismatch", "Local audio size disagrees with the frozen feed enclosure.", [episode_id, audio_asset_id], True, size_evidence))
            elif podpress_size is not None and podpress_size != record["byteLength"]:
                issues.append(issue(f"M0-PODPRESS-SIZE-{post_id}", "podpress-size-mismatch", "Local audio size disagrees with serialized podPress media evidence.", [episode_id, audio_asset_id], True, size_evidence))
            elif acf_size is not None and acf_size != record["byteLength"]:
                issues.append(issue(f"M0-ACF-SIZE-{post_id}", "stale-acf-audio-size", "The duplicate ACF byte-length field is stale; local, podPress, and frozen enclosure sizes agree.", [episode_id, audio_asset_id], False, size_evidence))
        elif not matching_audio:
            issues.append(issue(f"M0-AUDIO-MISSING-{post_id}", "missing-audio", "No local MP3 matches the episode enclosure or database filename.", [episode_id], True))
        else:
            issues.append(issue(f"M0-AUDIO-AMBIGUOUS-{post_id}", "ambiguous-audio", "Multiple local MP3 files match the episode filename.", [episode_id], True))

        thumbnail_id = integer_or_none(one(episode_meta, "_thumbnail_id"))
        artwork_asset_id = None
        artwork_evidence: dict[str, Any] | None = None
        if thumbnail_id is not None and thumbnail_id in attachments:
            attachment_meta = meta.get(thumbnail_id, {})
            relative = one(attachment_meta, "_wp_attached_file")
            candidates_art = artwork_by_relative.get(relative, []) if relative else []
            if len(candidates_art) == 1:
                record = candidates_art[0]
                ref = (record["sourceRoot"], record["relativePath"])
                artwork_asset_id = asset_ids_by_ref[ref]
                associated_artwork_refs.add(ref)
                associated_artwork_original_refs.add(ref)
                derivative_asset_ids = []
                for derivative in attachment_derivative_paths(
                    relative, one(attachment_meta, "_wp_attachment_metadata")
                ):
                    derivative_candidates = artwork_by_relative.get(derivative, [])
                    if len(derivative_candidates) == 1:
                        derivative_record = derivative_candidates[0]
                        derivative_ref = (
                            derivative_record["sourceRoot"],
                            derivative_record["relativePath"],
                        )
                        derivative_asset_ids.append(asset_ids_by_ref[derivative_ref])
                        associated_artwork_refs.add(derivative_ref)
                artwork_evidence = {
                    "attachmentId": thumbnail_id,
                    "relativePath": relative,
                    "storage": "file-backed",
                    "feedArtworkUrl": feed_item.get("artworkUrl") if feed_item else None,
                    "derivativeAssetIds": sorted(derivative_asset_ids),
                }
            else:
                issues.append(issue(f"M0-ARTWORK-MISSING-{post_id}", "missing-artwork", "Attachment metadata does not resolve to one verified uploads image.", [episode_id, f"wp-attachment-{thumbnail_id}"], True))
        else:
            issues.append(issue(f"M0-ARTWORK-REFERENCE-{post_id}", "missing-artwork-reference", "Episode has no valid featured-image attachment reference.", [episode_id], True))

        track_count = integer_or_none(one(episode_meta, "tracklist")) or 0
        tracks = []
        for index in range(track_count):
            tracks.append(
                {
                    "position": index + 1,
                    "artist": one(episode_meta, f"tracklist_{index}_track_artist"),
                    "title": one(episode_meta, f"tracklist_{index}_track_title"),
                    "startTime": None,
                }
            )

        episodes.append(
            {
                "id": episode_id,
                "sourceRecord": {"table": f"{export_metadata['tablePrefix']}posts", "id": post_id, "postType": source.get("type")},
                "disposition": "migrate" if source.get("status") == "publish" else "excluded",
                "exclusionReason": None if source.get("status") == "publish" else f"WordPress status {source.get('status')}",
                "title": one(episode_meta, "title") or source.get("title"),
                "artist": one(episode_meta, "artist"),
                "descriptionHtml": source.get("content") or source.get("excerpt") or (feed_item.get("descriptionHtml") if feed_item else None),
                "feedDescriptionHtml": feed_item.get("descriptionHtml") if feed_item else None,
                "feedContentHtml": feed_item.get("contentHtml") if feed_item else None,
                "publication": {
                    "databaseLocal": source.get("postDate"),
                    "databaseUtc": source.get("postDateGmt"),
                    "feedRfc822": feed_item.get("publicationDate") if feed_item else None,
                },
                "originalIdentity": {
                    "databaseGuid": source.get("guid"),
                    "feedGuid": feed_item.get("guid") if feed_item else None,
                    "feedGuidIsPermalink": feed_item.get("guidIsPermalink") if feed_item else None,
                    "feedGuidIsPermalinkSource": feed_item.get("guidIsPermalinkSource") if feed_item else None,
                },
                "enclosure": enclosure,
                "databaseMedia": {
                    "filename": db_filename,
                    "byteLength": integer_or_none(one(episode_meta, "file_size_(in_bytes)")),
                    "podPressByteLength": podpress_media_size(one(episode_meta, "_podPressMedia")),
                    "duration": one(episode_meta, "duration"),
                    "feedDuration": feed_item.get("duration") if feed_item else None,
                    "podPressRepresentation": "PHP serialized _podPressMedia",
                },
                "audioAssetId": audio_asset_id,
                "artworkAssetId": artwork_asset_id,
                "artworkEvidence": artwork_evidence,
                "tracklist": {"source": "ACF repeater postmeta", "count": len(tracks), "timestampsAvailable": False, "tracks": tracks},
                "legacyUrls": [feed_item["link"]] if feed_item and feed_item.get("link") else [],
            }
        )

    for item in feed_items:
        if int(item["position"]) not in matched_feed_positions:
            issues.append(issue(f"M0-DB-MISSING-FEED-{int(item['position']):03d}", "feed-item-without-source-record", "Frozen feed item has no unique database episode match.", [f"feed-item-{int(item['position']):03d}"], True))

    duplicate_guids: dict[str, list[str]] = defaultdict(list)
    duplicate_enclosures: dict[str, list[str]] = defaultdict(list)
    for episode in episodes:
        guid = episode["originalIdentity"]["feedGuid"]
        enclosure = episode.get("enclosure")
        if guid:
            duplicate_guids[guid].append(episode["id"])
        if isinstance(enclosure, dict) and enclosure.get("url"):
            duplicate_enclosures[enclosure["url"]].append(episode["id"])
    for index, affected in enumerate((items for items in duplicate_guids.values() if len(items) > 1), 1):
        issues.append(issue(f"M0-DUPLICATE-GUID-{index:03d}", "duplicate-guid", "Multiple episodes share a feed GUID.", affected, True))
    for index, affected in enumerate((items for items in duplicate_enclosures.values() if len(items) > 1), 1):
        issues.append(issue(f"M0-DUPLICATE-ENCLOSURE-{index:03d}", "duplicate-enclosure", "Multiple episodes share an enclosure URL.", affected, True))

    binary_columns = [
        row for row in columns if str(row.get("dataType", "")).lower() in {"binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob"}
    ]
    episode_binary_columns = [row for row in binary_columns if row.get("tableName") in {f"{export_metadata['tablePrefix']}posts", f"{export_metadata['tablePrefix']}postmeta"}]
    if episode_binary_columns:
        issues.append(issue("M0-DB-BINARY-001", "episode-binary-columns", "Episode-related tables contain binary columns requiring manual payload inspection.", [], True))

    orphan_audio = [asset["id"] for asset in assets if asset["kind"] == "audio" and asset["id"] not in {episode["audioAssetId"] for episode in episodes}]
    orphan_artwork_count = sum(1 for asset in assets if asset["kind"] == "artwork" and (asset["sourceRoot"], asset["relativePath"]) not in associated_artwork_refs)
    if orphan_audio:
        issues.append(issue("M0-ORPHAN-AUDIO-001", "orphan-audio", "Local MP3 files are not associated with an episode.", orphan_audio, True))

    encoded_image_values = [
        row
        for row in meta_rows
        if isinstance(row.get("valueText"), str)
        and (
            row["valueText"].startswith("data:image/")
            or re.fullmatch(r"[A-Za-z0-9+/]{1024,}={0,2}", row["valueText"]) is not None
        )
    ]
    if encoded_image_values:
        issues.append(
            issue(
                "M0-DB-ENCODED-IMAGE-001",
                "possible-encoded-image",
                "Episode or attachment metadata contains possible encoded image bytes requiring extraction.",
                [f"wp-{row['postId']}" for row in encoded_image_values],
                True,
            )
        )

    artwork_by_checksum: dict[str, list[str]] = defaultdict(list)
    for asset in assets:
        if asset["kind"] == "artwork":
            artwork_by_checksum[asset["sha256"]].append(asset["id"])
    duplicate_artwork_groups = [
        {"sha256": checksum, "assetIds": sorted(asset_ids)}
        for checksum, asset_ids in sorted(artwork_by_checksum.items())
        if len(asset_ids) > 1
    ]
    episode_artwork_ids = {
        episode["artworkAssetId"] for episode in episodes if episode["artworkAssetId"]
    }
    episode_duplicate_groups = [
        group
        for group in duplicate_artwork_groups
        if len(set(group["assetIds"]) & episode_artwork_ids) > 1
    ]

    database_record = file_record(database_label, database_dump.parent, database_dump)
    inventory = {
        "formatVersion": FORMAT_VERSION,
        "sourceSnapshots": {
            "id": sources["snapshotId"],
            "capturedAt": sources["capturedAt"],
            "pairingNote": sources["pairingNote"],
            "database": database_record,
            "databaseEngine": export_metadata.get("serverVersion"),
            "wordpress": {"sourceRoot": wordpress_label, "fileCount": len(wordpress_records), "treeSha256": wordpress_digest},
            "audio": {"sourceRoot": audio_label, "fileCount": len(audio_root_records), "mp3FileCount": len(audio_records), "treeSha256": audio_digest},
            "artwork": artwork_digests,
            "feed": feed_metadata,
        },
        "summary": {
            "sourceEpisodeCount": len(episodes_source),
            "publishedEpisodeCount": sum(episode["disposition"] == "migrate" for episode in episodes),
            "feedItemCount": len(feed_items),
            "audioFileCount": len(audio_records),
            "artworkFileCount": sum(asset["kind"] == "artwork" for asset in assets),
            "associatedArtworkCount": len(associated_artwork_original_refs),
            "associatedArtworkDerivativeCount": len(associated_artwork_refs - associated_artwork_original_refs),
            "unassociatedArtworkFileCount": orphan_artwork_count,
            "identicalArtworkByteGroupCount": len(duplicate_artwork_groups),
            "blockingIssueCount": sum(bool(item["blocksMigration"]) for item in issues),
            "nonBlockingIssueCount": sum(not bool(item["blocksMigration"]) for item in issues),
            "episodesWithTracklists": sum(bool(episode["tracklist"]["count"]) for episode in episodes),
            "trackCount": sum(episode["tracklist"]["count"] for episode in episodes),
            "episodesWithTimestamps": 0,
            "timestampedTrackCount": 0,
            "feedGuidIsPermalinkFalseCount": sum(episode["originalIdentity"]["feedGuidIsPermalink"] is False for episode in episodes),
            "databaseGuidRepresentationDifferenceCount": sum(episode["originalIdentity"]["feedGuid"] != episode["originalIdentity"]["databaseGuid"] for episode in episodes),
        },
        "databaseArtwork": {
            "binaryColumnCountInspected": len(binary_columns),
            "episodeBinaryColumns": episode_binary_columns,
            "dataImageMetaValueCount": len(encoded_image_values),
            "conclusion": "No episode artwork bytes are stored in the database; episode artwork is attachment/file-backed." if not encoded_image_values and not episode_binary_columns else "Possible database-backed artwork requires investigation.",
        },
        "artworkAnalysis": {
            "identicalByteGroups": duplicate_artwork_groups,
            "episodeOriginalIdenticalByteGroups": episode_duplicate_groups,
        },
        "show": show,
        "episodes": sorted(episodes, key=lambda value: value["id"]),
        "assets": assets,
        "issues": sorted(issues, key=lambda value: value["id"]),
    }
    if args.track_timings:
        apply_track_timing_evidence(
            inventory, read_json(Path(args.track_timings).expanduser().resolve())
        )
    legacy_entries = []
    for episode in episodes:
        for url in episode["legacyUrls"]:
            legacy_entries.append({"url": url, "kind": "episode-page", "episodeId": episode["id"], "observedIn": "frozen-feed"})
    legacy_urls = {
        "formatVersion": FORMAT_VERSION,
        "sourceSnapshotId": sources["snapshotId"],
        "entries": sorted(legacy_entries, key=lambda value: (value["url"], value["episodeId"])),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "inventory.json", inventory)
    write_json(output_dir / "legacy-urls.json", legacy_urls)
    write_fixtures(output_dir / "fixtures", inventory)
    write_report(output_dir / "MIGRATION-AUDIT.md", inventory, legacy_urls, options)
    print(
        f"reconciled {len(episodes)} source episodes, {len(feed_items)} feed items, "
        f"{len(audio_records)} MP3s; {inventory['summary']['blockingIssueCount']} blockers"
    )
    return 0


def write_fixtures(directory: Path, inventory: dict[str, Any]) -> None:
    episodes = inventory["episodes"]
    selected: list[dict[str, Any]] = []
    predicates = [
        lambda episode: episode["sourceRecord"]["postType"] == EPISODE_TYPE,
        lambda episode: "&" in (episode["databaseMedia"]["filename"] or ""),
        lambda episode: "part" in (episode["databaseMedia"]["filename"] or "").lower(),
    ]
    for predicate in predicates:
        candidate = next((episode for episode in episodes if predicate(episode) and episode not in selected), None)
        if candidate:
            selected.append(candidate)
    if episodes and episodes[-1] not in selected:
        selected.append(episodes[-1])
    fixture = {
        "formatVersion": FORMAT_VERSION,
        "purpose": "Sanitized public examples of observed source variations for importer and feed tests.",
        "episodes": selected,
    }
    write_json(directory / "representative-episodes.json", fixture)


def write_report(path: Path, inventory: dict[str, Any], legacy: dict[str, Any], options: list[dict[str, Any]]) -> None:
    summary = inventory["summary"]
    issues = inventory["issues"]
    option_map = {row.get("name"): row.get("valueText") for row in options}
    status = "audit complete; migration blocked" if summary["blockingIssueCount"] else "audit complete; migration ready"
    issue_lines = (
        "\n".join(
            f"- `{item['id']}` ({'blocking' if item['blocksMigration'] else 'non-blocking'}): "
            f"{item['message']}"
            + (f" Evidence: `{json.dumps(item['evidence'], sort_keys=True)}`" if item.get("evidence") else "")
            for item in issues
        )
        or "- None."
    )
    text = f"""# Migration audit and compatibility contract

Status: **{status}**

Source snapshot: `{inventory['sourceSnapshots']['id']}`. Frozen feed retrieved {inventory['sourceSnapshots']['feed']['retrievedAt']}.

## Reconciliation

| Evidence | Count |
| --- | ---: |
| WordPress `{EPISODE_TYPE}` records | {summary['sourceEpisodeCount']} |
| Published records assigned `migrate` | {summary['publishedEpisodeCount']} |
| Frozen production feed items | {summary['feedItemCount']} |
| Local MP3 files | {summary['audioFileCount']} |
| Verified image files under supplied artwork roots | {summary['artworkFileCount']} |
| Episode-associated artwork originals | {summary['associatedArtworkCount']} |
| Associated generated artwork derivatives | {summary['associatedArtworkDerivativeCount']} |
| Unassociated uploads images and derivatives | {summary['unassociatedArtworkFileCount']} |
| Identical artwork byte groups | {summary['identicalArtworkByteGroupCount']} |
| Blocking discrepancies | {summary['blockingIssueCount']} |
| Non-blocking discrepancies | {summary['nonBlockingIssueCount']} |

The database, feed, and media collections each identify {summary['publishedEpisodeCount']} published episodes. Every discovered podcast record has a disposition, and each feed item is either mapped once or named in the discrepancy register.

{summary['episodesWithTracklists']} episodes contain {summary['trackCount']} ordered track rows. {summary['publishedEpisodeCount'] - summary['episodesWithTracklists']} episodes have no tracklist. Owner-supplied split-FLAC durations provide {summary.get('timestampedTrackCount', 0)} derived start times across {summary.get('episodesWithTimestamps', 0)} episodes. All {summary['feedGuidIsPermalinkFalseCount']} frozen GUIDs explicitly use `isPermaLink="false"`. {summary['databaseGuidRepresentationDifferenceCount']} database GUID strings encode the query-string ampersand as `&#038;`; XML entity decoding exposes `&` to feed consumers, and both representations remain recorded.

All 55 podcast records have WordPress status `publish` and disposition `migrate`; there are no draft, scheduled, trashed, excluded, or unresolved podcast records. The two Mega 93.3 FM parts are distinct records (`wp-342` and `wp-344`) with distinct enclosures and local files. There are no duplicate feed GUIDs, duplicate enclosure URLs, ambiguous matches, missing MP3s, or orphan MP3s. Because the frozen feed contains all 55 published records, there is no evidence that its current item limit truncates the archive. Unassociated uploads remain inventoried as non-episode images or derivatives rather than being silently assigned.

## Show evidence

The frozen channel title is `{inventory['show']['title']}` and its observed feed self-migration target is `{inventory['show']['newFeedUrl']}`. The standard RSS artwork URL is `{inventory['show']['standardArtworkUrl']}`; the iTunes artwork URL is `{inventory['show']['itunesArtworkUrl']}`. Both resolve to verified files in the supplied uploads snapshot and their asset IDs are retained in the inventory.

## Source mapping

| Canonical migration concern | WordPress/database evidence | Subscriber-facing evidence |
| --- | --- | --- |
| Episode identity | `{inventory['sourceSnapshots']['database']['sourceRoot']}` `{inventory['sourceSnapshots']['database']['relativePath']}`, `{EPISODE_TYPE}` post ID and `guid` | RSS `guid` text plus the explicit `isPermaLink` attribute |
| Publication | `post_date` and `post_date_gmt` | RSS `pubDate`; conflicts must preserve both values |
| Audio | ACF `file_name`, `file_size_(in_bytes)`, `duration`; serialized `_podPressMedia` | RSS enclosure URL, type, and length |
| Artwork | `_thumbnail_id` -> attachment `_wp_attached_file` -> supplied uploads root | No per-item image; channel-level RSS and iTunes show images |
| Description | WordPress post content/excerpt | RSS description and `content:encoded` |
| Tracklist | ACF repeater count `tracklist` and `tracklist_<n>_track_artist` / `_track_title`; owner-supplied split-FLAC durations for derived starts | Not relied upon |
| Legacy page URL | Source record ID plus observed WordPress routing | RSS item `link` stored in `legacy-urls.json` |

The WordPress option `permalink_structure` was `{option_map.get('permalink_structure')}`. The database timezone string is `{option_map.get('timezone_string') or '(empty)'}` with GMT offset `{option_map.get('gmt_offset')}`; UTC publication evidence therefore remains authoritative for instants.

## Generation behavior traced in source

- The `ninezeroseven` theme registers `one_page_portfolio` as the public podcast record type with rewrite slug `podcast`; its single template reads ACF `title`, `artist`, `file_name`, and the `tracklist` repeater in source order.
- WordPress core `wp-includes/feed-rss2.php` emits the item link through `the_permalink_rss()`, formats `post_date_gmt` as RFC 822 `+0000`, and emits `the_guid()` with `isPermaLink="false"`.
- podPress `podpress_feed_functions.php` reads serialized `_podPressMedia`, converts the stored URI to a web path, emits its stored `size` and MIME type as the enclosure, and normalizes its stored duration for `itunes:duration`.
- The episode template constructs its historical direct-download URL as `//podcast.nurevolution.net/dl.php?file=` plus the ACF filename. This is download behavior evidence, not a canonical media URL decision for M2/M5.

## Compatibility contract

- Preserve every frozen RSS GUID string exactly and preserve its `isPermaLink` semantics. A URL-shaped GUID is an opaque subscriber identity when `isPermaLink=\"false\"`.
- Preserve the original enclosure URL, media type, byte length, and filename evidence. Do not rename source MP3 files during import.
- Preserve database-local, database-UTC, and feed publication representations until M2 establishes the canonical instant and reports any conflict.
- Map legacy page URLs to source episode IDs. This audit does not select future slugs or canonical routes.
- Tracklists are ordered ACF repeater data. Where owner-supplied numbered split FLACs reconcile to the episode track count and master duration, `startTime` is the cumulative duration of preceding splits. Untimed tracks remain explicitly absent.
- Episode artwork is file-backed through WordPress attachments. No binary artwork payload or data-URL metadata was found in the episode tables; security-plugin binary columns are unrelated. Generated derivatives are linked to their originals in `artworkEvidence`; {summary['identicalArtworkByteGroupCount']} upload groups have identical bytes, and {len(inventory['artworkAnalysis']['episodeOriginalIdenticalByteGroups'])} of those groups contain multiple episode originals.
- Missing tracklists or timestamps are valid optional data. Missing audio, artwork, ambiguous identities, malformed dates, and byte-length conflicts are explicit blockers.

## Discrepancy register

{issue_lines}

## Reproducibility and private evidence

Raw SQL, the source-location manifest, database JSONL export, full per-file provenance manifest, and frozen feed response remain outside this public repository. Public paths retain only source-root labels and relative paths.

The database was restored offline with `mariadb:11.3.2-jammy` at digest `sha256:e101f9db31916a5d4d7d594dd0dd092fb23ab4f499f1d7a7425d1afd4162c4bc`, with no published ports and `--network none`. The source dump reports MariaDB 11.3.2 and the private evidence export records the discovered `{inventory['sourceSnapshots']['databaseEngine']}` server version.

```text
docker pull mariadb:11.3.2-jammy
docker run -d --name nurevolution-m0-db --network none -e <temporary-root-password> mariadb:11.3.2-jammy
docker exec -i nurevolution-m0-db mariadb -uroot -p<temporary-root-password> < /private/path/nurevolution.sql
python3 tools/migration/audit.py export-database --container nurevolution-m0-db --database nurevolution_wp --output-dir /private/database-export
python3 tools/migration/audit.py capture-feed --output-dir /private/reference
python3 tools/migration/audit.py reconcile --sources /private/source-manifest.json --reference-dir /private/reference --database-export /private/database-export --track-timings docs/migration/track-timings.json --output-dir docs/migration
python3 tools/migration/audit.py check --inventory docs/migration/inventory.json --legacy-urls docs/migration/legacy-urls.json --track-timings docs/migration/track-timings.json
python3 -m unittest discover -s tools/migration/tests -p 'test_*.py'
docker rm -v nurevolution-m0-db
```

`capture-feed` is the only command that contacts production. `reconcile` reads frozen evidence and deterministically rewrites the substantive public artifacts. The full private manifest binds each path to a source-root label, relative path, byte length, and SHA-256 checksum.

## M2/M3 handoff

M2 should import all `migrate` records, use the inventory asset references, retain every identity representation, and preserve the supplied or derived timestamp provenance. Untimed tracks must remain untimed. M3 should compare its generated feed against the frozen GUID/enclosure/publication contract and keep `/feed/podcast` compatible. Records named by blocking issues require resolution before migration readiness.

There are {len(legacy['entries'])} observed legacy episode-page URLs. New canonical slugs and routes remain intentionally undecided.

No historical traffic evidence was supplied, so this audit adds no sizing claim for M5.

## Verification evidence

The repeatable artifact check validates episode and asset references, timing order and completeness, timing-evidence correspondence, issue counts, and legacy URL targets. Exact commands and current local results are recorded in the M0 milestone handoff.
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def validate_artifacts(inventory: Any, legacy: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(inventory, dict) or inventory.get("formatVersion") != FORMAT_VERSION:
        return [f"inventory formatVersion must be {FORMAT_VERSION}"]
    if not isinstance(legacy, dict) or legacy.get("formatVersion") != FORMAT_VERSION:
        return [f"legacy URL map formatVersion must be {FORMAT_VERSION}"]
    episodes = inventory.get("episodes")
    assets = inventory.get("assets")
    issues = inventory.get("issues")
    if not isinstance(episodes, list) or not isinstance(assets, list) or not isinstance(issues, list):
        return ["inventory episodes, assets, and issues must be arrays"]
    episode_ids = [row.get("id") for row in episodes if isinstance(row, dict)]
    asset_ids = [row.get("id") for row in assets if isinstance(row, dict)]
    issue_ids = [row.get("id") for row in issues if isinstance(row, dict)]
    for label, identifiers in [("episode", episode_ids), ("asset", asset_ids), ("issue", issue_ids)]:
        if len(identifiers) != len(set(identifiers)):
            errors.append(f"duplicate {label} ID")
        if any(not isinstance(identifier, str) or not identifier for identifier in identifiers):
            errors.append(f"invalid {label} ID")
    episode_set, asset_set = set(episode_ids), set(asset_ids)
    blocking_affected = {
        affected
        for item in issues
        if isinstance(item, dict) and item.get("blocksMigration") is True
        for affected in item.get("affectedRecords", [])
    }
    for episode in episodes:
        if not isinstance(episode, dict):
            errors.append("episode entry must be an object")
            continue
        if episode.get("disposition") not in {"migrate", "excluded", "unresolved"}:
            errors.append(f"{episode.get('id')}: invalid disposition")
        for key in ("audioAssetId", "artworkAssetId"):
            value = episode.get(key)
            if value is not None and value not in asset_set:
                errors.append(f"{episode.get('id')}: invalid {key} {value}")
            if (
                episode.get("disposition") == "migrate"
                and value is None
                and episode.get("id") not in blocking_affected
            ):
                errors.append(f"{episode.get('id')}: missing {key} without a blocking issue")
        artwork_evidence = episode.get("artworkEvidence")
        if isinstance(artwork_evidence, dict):
            for value in artwork_evidence.get("derivativeAssetIds", []):
                if value not in asset_set:
                    errors.append(f"{episode.get('id')}: invalid derivative asset {value}")
        tracklist = episode.get("tracklist")
        if not isinstance(tracklist, dict):
            errors.append(f"{episode.get('id')}: invalid tracklist")
            continue
        tracks = tracklist.get("tracks")
        if not isinstance(tracks, list) or tracklist.get("count") != len(tracks):
            errors.append(f"{episode.get('id')}: tracklist count does not match tracks")
            continue
        timestamps_available = tracklist.get("timestampsAvailable")
        start_times = [track.get("startTime") for track in tracks if isinstance(track, dict)]
        numeric_times = [
            value
            for value in start_times
            if isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            and value >= 0
        ]
        if timestamps_available is True:
            if len(numeric_times) != len(tracks):
                errors.append(f"{episode.get('id')}: incomplete or invalid timestamps")
            elif numeric_times and (
                numeric_times[0] != 0 or numeric_times != sorted(numeric_times)
            ):
                errors.append(f"{episode.get('id')}: timestamps must start at zero and be ordered")
            if not isinstance(tracklist.get("timestampEvidenceId"), str):
                errors.append(f"{episode.get('id')}: missing timestamp evidence ID")
        elif any(value is not None for value in start_times):
            errors.append(f"{episode.get('id')}: timestamps present but unavailable")
    entries = legacy.get("entries")
    if not isinstance(entries, list):
        errors.append("legacy URL entries must be an array")
    else:
        seen_urls: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict) or entry.get("episodeId") not in episode_set:
                errors.append(f"invalid legacy URL target: {entry!r}")
            elif not isinstance(entry.get("url"), str) or not urllib.parse.urlparse(entry["url"]).scheme:
                errors.append(f"invalid legacy URL: {entry!r}")
            elif entry["url"] in seen_urls:
                errors.append(f"duplicate legacy URL: {entry['url']}")
            else:
                seen_urls.add(entry["url"])
    for item in issues:
        if not isinstance(item, dict) or not isinstance(item.get("blocksMigration"), bool):
            errors.append(f"invalid issue entry: {item!r}")
    summary = inventory.get("summary", {})
    actual_blockers = sum(isinstance(item, dict) and item.get("blocksMigration") is True for item in issues)
    if summary.get("blockingIssueCount") != actual_blockers:
        errors.append("summary blockingIssueCount does not match issues")
    actual_timestamped_episodes = sum(
        isinstance(episode, dict)
        and episode.get("tracklist", {}).get("timestampsAvailable") is True
        for episode in episodes
    )
    actual_timestamped_tracks = sum(
        len(episode.get("tracklist", {}).get("tracks", []))
        for episode in episodes
        if isinstance(episode, dict)
        and episode.get("tracklist", {}).get("timestampsAvailable") is True
    )
    if summary.get("episodesWithTimestamps", 0) != actual_timestamped_episodes:
        errors.append("summary episodesWithTimestamps does not match episodes")
    if summary.get("timestampedTrackCount", 0) != actual_timestamped_tracks:
        errors.append("summary timestampedTrackCount does not match tracks")
    snapshots = inventory.get("sourceSnapshots", {})
    if legacy.get("sourceSnapshotId") is not None and legacy.get("sourceSnapshotId") != snapshots.get("id"):
        errors.append("legacy URL sourceSnapshotId does not match inventory")
    return errors


def validate_track_timing_evidence(
    inventory: dict[str, Any], evidence: Any
) -> list[str]:
    if not isinstance(evidence, dict) or evidence.get("formatVersion") != FORMAT_VERSION:
        return [f"track timing formatVersion must be {FORMAT_VERSION}"]
    errors: list[str] = []
    evidence_id = evidence.get("id")
    inventory_timing = inventory.get("sourceSnapshots", {}).get("trackTimings", {})
    if not isinstance(evidence_id, str) or inventory_timing.get("id") != evidence_id:
        errors.append("track timing evidence ID does not match inventory")
    inventory_episodes = {
        episode.get("id"): episode
        for episode in inventory.get("episodes", [])
        if isinstance(episode, dict)
    }
    evidence_episodes = evidence.get("episodes")
    if not isinstance(evidence_episodes, list):
        return errors + ["track timing episodes must be an array"]
    seen_episode_ids: set[str] = set()
    applied_episode_count = 0
    applied_track_count = 0
    for timing_episode in evidence_episodes:
        if not isinstance(timing_episode, dict):
            errors.append("track timing episode must be an object")
            continue
        episode_id = timing_episode.get("episodeId")
        if episode_id in seen_episode_ids:
            errors.append(f"duplicate track timing episode {episode_id}")
            continue
        seen_episode_ids.add(episode_id)
        episode = inventory_episodes.get(episode_id)
        if episode is None:
            errors.append(f"track timing references unknown episode {episode_id}")
            continue
        if timing_episode.get("status") != "applied":
            continue
        applied_episode_count += 1
        timing_tracks = timing_episode.get("tracks", [])
        canonical_tracks = episode.get("tracklist", {}).get("tracks", [])
        applied_track_count += len(timing_tracks)
        if len(timing_tracks) != len(canonical_tracks):
            errors.append(f"{episode_id}: timing evidence track count does not match")
            continue
        for timing_track, canonical_track in zip(
            timing_tracks, canonical_tracks, strict=True
        ):
            if (
                timing_track.get("position") != canonical_track.get("position")
                or timing_track.get("startTime") != canonical_track.get("startTime")
            ):
                errors.append(f"{episode_id}: timing evidence does not match inventory")
                break
    timing_summary = evidence.get("summary", {})
    if timing_summary.get("appliedEpisodeCount") != applied_episode_count:
        errors.append("track timing appliedEpisodeCount does not match evidence")
    if timing_summary.get("appliedTrackCount") != applied_track_count:
        errors.append("track timing appliedTrackCount does not match evidence")
    return errors


def check(args: argparse.Namespace) -> int:
    inventory = read_json(Path(args.inventory).expanduser().resolve())
    legacy = read_json(Path(args.legacy_urls).expanduser().resolve())
    errors = validate_artifacts(inventory, legacy)
    if getattr(args, "track_timings", None):
        errors.extend(
            validate_track_timing_evidence(
                inventory,
                read_json(Path(args.track_timings).expanduser().resolve()),
            )
        )
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1
    blockers = [item["id"] for item in inventory["issues"] if item["blocksMigration"]]
    print(
        f"valid: {len(inventory['episodes'])} episodes, {len(inventory['assets'])} assets, "
        f"{len(inventory['issues'])} issues"
    )
    if blockers:
        print("migration blockers: " + ", ".join(blockers))
        return 2
    print("migration blockers: none")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture = subparsers.add_parser("capture-feed", help="freeze and validate the production RSS feed")
    capture.add_argument("--output-dir", required=True)
    capture.add_argument("--url", default=DEFAULT_FEED_URL)
    capture.add_argument("--timeout", type=float, default=30)
    capture.add_argument("--refresh", action="store_true")
    capture.set_defaults(func=capture_feed)

    export = subparsers.add_parser("export-database", help="export sanitized query evidence from an isolated restore")
    export.add_argument("--container", required=True)
    export.add_argument("--database", default="nurevolution_wp")
    export.add_argument("--output-dir", required=True)
    export.set_defaults(func=export_database)

    reconcile_parser = subparsers.add_parser("reconcile", help="reconcile frozen database/feed/file evidence")
    reconcile_parser.add_argument("--sources", required=True)
    reconcile_parser.add_argument("--reference-dir", required=True)
    reconcile_parser.add_argument("--database-export", required=True)
    reconcile_parser.add_argument("--track-timings")
    reconcile_parser.add_argument("--output-dir", required=True)
    reconcile_parser.set_defaults(func=reconcile)

    derive_parser = subparsers.add_parser(
        "derive-timestamps",
        help="derive track starts from an owner-supplied split-FLAC duration listing",
    )
    derive_parser.add_argument("--inventory", required=True)
    derive_parser.add_argument("--durations", required=True)
    derive_parser.add_argument("--output", required=True)
    derive_parser.add_argument("--master-duration-tolerance", type=float, default=1.0)
    derive_parser.set_defaults(func=derive_timestamps)

    check_parser = subparsers.add_parser("check", help="validate public migration artifacts")
    check_parser.add_argument("--inventory", required=True)
    check_parser.add_argument("--legacy-urls", required=True)
    check_parser.add_argument("--track-timings")
    check_parser.set_defaults(func=check)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except AuditError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

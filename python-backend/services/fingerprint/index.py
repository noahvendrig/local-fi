"""On-disk landmark storage + in-memory inverted index for fingerprint matching.

Durable source of truth is one small per-track sidecar file (raw landmark
list) under `tracks/<shard>/<track_id>.lfpt`; the inverted index (hash ->
postings) is a derived, rebuildable in-memory structure, checkpointed to disk
so a restart doesn't have to re-scan every sidecar -- but the checkpoint is
never the only copy of anything, and a missing/corrupt checkpoint just costs
a rebuild pass over the sidecars, not data loss.

Single-process, single-user (mirrors local-fi's own ARCHITECTURE.md §3.7) --
the whole index is kept in memory, which is a deliberate "keep it simple"
choice for a personal-library scale, not something built to shard across
processes.
"""
from __future__ import annotations

import pickle
from collections import defaultdict
from pathlib import Path
from threading import Lock

from .hashing import build_hashes
from .landmarks import Landmark
from .matching import Posting

SIDECAR_MAGIC = b"LFPT"
SIDECAR_VERSION = 1


class FingerprintIndex:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.tracks_dir = data_dir / "tracks"
        self.tracks_dir.mkdir(parents=True, exist_ok=True)
        self._checkpoint_path = data_dir / "index_checkpoint.pkl"
        self._lock = Lock()
        self._index: dict[int, list[Posting]] = defaultdict(list)
        self._track_ids: set[int] = set()
        self._load_checkpoint_or_rebuild()

    def _sidecar_path(self, track_id: int) -> Path:
        shard = f"{track_id % 256:02x}"
        shard_dir = self.tracks_dir / shard
        shard_dir.mkdir(exist_ok=True)
        return shard_dir / f"{track_id}.lfpt"

    def _write_sidecar(self, track_id: int, landmarks: list[Landmark]) -> None:
        import struct

        path = self._sidecar_path(track_id)
        with open(path, "wb") as f:
            f.write(SIDECAR_MAGIC)
            f.write(struct.pack("<II", SIDECAR_VERSION, len(landmarks)))
            for lm in landmarks:
                f.write(struct.pack("<If", int(lm.time_ms), lm.freq_hz))

    def _read_sidecar(self, track_id: int) -> list[Landmark]:
        import struct

        path = self._sidecar_path(track_id)
        with open(path, "rb") as f:
            magic = f.read(4)
            if magic != SIDECAR_MAGIC:
                raise ValueError(f"bad sidecar magic for track {track_id}")
            _version, count = struct.unpack("<II", f.read(8))
            landmarks = []
            for _ in range(count):
                time_ms, freq_hz = struct.unpack("<If", f.read(8))
                # Magnitude isn't persisted -- it's only used transiently during
                # extraction/hashing (hashing.py never reads it), so there's
                # nothing lost by not round-tripping it through the sidecar.
                landmarks.append(Landmark(time_ms=float(time_ms), freq_hz=freq_hz, magnitude=0.0))
            return landmarks

    def has_track(self, track_id: int) -> bool:
        return track_id in self._track_ids

    def add_track(self, track_id: int, landmarks: list[Landmark]) -> int:
        """Writes the sidecar and merges the track's hashes into the in-memory
        index. Does NOT checkpoint -- call checkpoint() once after a batch of
        adds (see job_manager.py) so a large backfill isn't O(n) pickle-dumps
        of the whole index."""
        self._write_sidecar(track_id, landmarks)
        hashes = build_hashes(landmarks)
        with self._lock:
            if track_id in self._track_ids:
                self._remove_track_postings(track_id)
            for h in hashes:
                self._index[h.value].append(Posting(track_id=track_id, time_ms=h.anchor_time_ms))
            self._track_ids.add(track_id)
        return len(landmarks)

    def remove_track(self, track_id: int) -> bool:
        """Forgets a track entirely -- sidecar, postings and id -- and checkpoints.

        Called when the track is purged from local-fi's library (lib/library/trash.ts's
        purgeTrack). Without this the index keeps matching mixtapes against a track id
        that no longer has a `tracks` row, which fails the mixtape_segments foreign key.
        Unlike add_track this checkpoints immediately: deletes are one-at-a-time, not a
        batch backfill."""
        self._sidecar_path(track_id).unlink(missing_ok=True)
        with self._lock:
            known = track_id in self._track_ids
            self._remove_track_postings(track_id)
            self._track_ids.discard(track_id)
        self.checkpoint()
        return known

    def _remove_track_postings(self, track_id: int) -> None:
        for key in list(self._index.keys()):
            filtered = [p for p in self._index[key] if p.track_id != track_id]
            if filtered:
                self._index[key] = filtered
            else:
                del self._index[key]

    def snapshot(self) -> dict[int, list[Posting]]:
        with self._lock:
            return {k: list(v) for k, v in self._index.items()}

    def track_count(self) -> int:
        return len(self._track_ids)

    def checkpoint(self) -> None:
        with self._lock:
            with open(self._checkpoint_path, "wb") as f:
                pickle.dump({"index": dict(self._index), "track_ids": self._track_ids}, f)

    def _load_checkpoint_or_rebuild(self) -> None:
        if self._checkpoint_path.exists():
            try:
                with open(self._checkpoint_path, "rb") as f:
                    data = pickle.load(f)
                self._index = defaultdict(list, data["index"])
                self._track_ids = data["track_ids"]
                return
            except Exception:
                pass  # corrupt/incompatible checkpoint -- fall through to rebuild
        self._rebuild_from_sidecars()

    def _rebuild_from_sidecars(self) -> None:
        self._index = defaultdict(list)
        self._track_ids = set()
        for shard_dir in self.tracks_dir.glob("*"):
            if not shard_dir.is_dir():
                continue
            for sidecar in shard_dir.glob("*.lfpt"):
                track_id = int(sidecar.stem)
                landmarks = self._read_sidecar(track_id)
                for h in build_hashes(landmarks):
                    self._index[h.value].append(Posting(track_id=track_id, time_ms=h.anchor_time_ms))
                self._track_ids.add(track_id)
        if self._track_ids:
            self.checkpoint()

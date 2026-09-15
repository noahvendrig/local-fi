"""On-disk embedding storage + in-memory k-NN similarity graph for Smart Shuffle.

Durable source of truth is one small per-track sidecar file (a raw L2-normalized embedding
vector) under `tracks/<shard>/<track_id>.lfsv`; the vector matrix and precomputed k-NN graph are
derived, rebuildable in-memory structures, checkpointed to disk so a restart doesn't have to
re-read every sidecar -- but the checkpoint is never the only copy of anything, and a
missing/corrupt checkpoint just costs a rebuild pass over the sidecars, not data loss. Same
"keep it simple, personal-library scale, not built to shard" posture as
services/fingerprint/index.py's FingerprintIndex -- see that file's module docstring.
"""
from __future__ import annotations

import pickle
import struct
from pathlib import Path
from threading import Lock

import numpy as np

from .embedding import EMBED_DIM

SIDECAR_MAGIC = b"LFSV"
SIDECAR_VERSION = 1
NEIGHBORS_K = 25  # precomputed neighbor-list size per track, for the whole-library graph path


class SimilarityIndex:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.tracks_dir = data_dir / "tracks"
        self.tracks_dir.mkdir(parents=True, exist_ok=True)
        self._checkpoint_path = data_dir / "index_checkpoint.pkl"
        self._lock = Lock()
        self._track_ids: list[int] = []
        self._id_to_row: dict[int, int] = {}
        self._vectors: list[np.ndarray] = []  # each float32[EMBED_DIM], pre-L2-normalized
        self._neighbors: dict[int, list[tuple[int, float]]] = {}
        self._load_checkpoint_or_rebuild()

    def _sidecar_path(self, track_id: int) -> Path:
        shard = f"{track_id % 256:02x}"
        shard_dir = self.tracks_dir / shard
        shard_dir.mkdir(exist_ok=True)
        return shard_dir / f"{track_id}.lfsv"

    def _write_sidecar(self, track_id: int, vector: np.ndarray) -> None:
        path = self._sidecar_path(track_id)
        with open(path, "wb") as f:
            f.write(SIDECAR_MAGIC)
            f.write(struct.pack("<I", SIDECAR_VERSION))
            f.write(vector.astype("<f4").tobytes())

    def _read_sidecar(self, track_id: int) -> np.ndarray:
        path = self._sidecar_path(track_id)
        with open(path, "rb") as f:
            magic = f.read(4)
            if magic != SIDECAR_MAGIC:
                raise ValueError(f"bad sidecar magic for track {track_id}")
            (_version,) = struct.unpack("<I", f.read(4))
            data = f.read(EMBED_DIM * 4)
            return np.frombuffer(data, dtype="<f4").copy()

    def has_track(self, track_id: int) -> bool:
        return track_id in self._id_to_row

    def track_count(self) -> int:
        return len(self._track_ids)

    def _matrix(self) -> np.ndarray:
        """Materializes the full (N, EMBED_DIM) matrix on demand -- personal-library scale (low
        thousands of tracks) makes this cheap enough to not need a persistent growable array;
        simplicity wins over micro-optimizing a stack() call. Callers must hold self._lock."""
        if not self._vectors:
            return np.empty((0, EMBED_DIM), dtype=np.float32)
        return np.stack(self._vectors, axis=0)

    def add_track(self, track_id: int, vector: np.ndarray) -> None:
        """Writes the sidecar, upserts the vector (replace, not duplicate, on re-add), and
        computes *this one track's* neighbor list fresh against the full current matrix. Does
        NOT refresh every other existing track's neighbor list -- that would mean an
        O(N^2 * D) recompute on every single-track add, which doesn't scale to routine
        one-at-a-time imports. Other tracks' lists go stale exactly the way the checkpoint itself
        does; rebuild_graph() (called by job_manager.py after a multi-track batch) is the
        periodic fix. Does NOT checkpoint -- call checkpoint() once after a batch of adds, same
        convention as FingerprintIndex.add_track."""
        vector = vector.astype(np.float32, copy=False)
        self._write_sidecar(track_id, vector)
        with self._lock:
            if track_id in self._id_to_row:
                self._vectors[self._id_to_row[track_id]] = vector
            else:
                self._id_to_row[track_id] = len(self._track_ids)
                self._track_ids.append(track_id)
                self._vectors.append(vector)
            self._neighbors[track_id] = self._compute_neighbors_locked(track_id, vector)

    def _compute_neighbors_locked(self, track_id: int, vector: np.ndarray, k: int = NEIGHBORS_K) -> list[tuple[int, float]]:
        if len(self._track_ids) <= 1:
            return []
        matrix = self._matrix()
        scores = matrix @ vector  # pre-normalized vectors, so this is already cosine similarity
        order = np.argsort(-scores)
        result: list[tuple[int, float]] = []
        for row in order:
            tid = self._track_ids[row]
            if tid == track_id:
                continue
            result.append((tid, float(scores[row])))
            if len(result) >= k:
                break
        return result

    def rebuild_graph(self, k: int = NEIGHBORS_K) -> None:
        """Full O(N^2 * D) recompute of every track's top-K neighbor list. Called once at the
        end of a multi-track batch job (initial scan/backfill), not after every single-track
        auto-import -- see job_manager.py. At personal-library scale (low thousands of tracks)
        this is a background-job-scale cost (seconds), not something that needs to be
        incremental-only from day one."""
        with self._lock:
            matrix = self._matrix()
            if matrix.shape[0] <= 1:
                self._neighbors = {tid: [] for tid in self._track_ids}
                return
            sims = matrix @ matrix.T  # (N, N) cosine similarity -- vectors are already normalized
            neighbors: dict[int, list[tuple[int, float]]] = {}
            for row, track_id in enumerate(self._track_ids):
                order = np.argsort(-sims[row])
                entries: list[tuple[int, float]] = []
                for other_row in order:
                    if other_row == row:
                        continue
                    entries.append((self._track_ids[other_row], float(sims[row, other_row])))
                    if len(entries) >= k:
                        break
                neighbors[track_id] = entries
            self._neighbors = neighbors

    def similar(
        self,
        track_id: int,
        candidate_ids: list[int] | None,
        exclude_ids: set[int],
        top_k: int,
    ) -> list[tuple[int, float]]:
        """candidate_ids given (crate-scoped case): live brute-force cosine query restricted to
        those ids, minus exclude_ids -- small, dynamic sets, so a fresh search is cheap and
        correct-by-construction. candidate_ids omitted (whole-library case): an O(K) filter of
        the precomputed neighbor list instead of a fresh search."""
        with self._lock:
            if track_id not in self._id_to_row:
                return []

            if candidate_ids is not None:
                query = self._vectors[self._id_to_row[track_id]]
                rows: list[int] = []
                ids: list[int] = []
                for cid in candidate_ids:
                    if cid == track_id or cid in exclude_ids:
                        continue
                    row = self._id_to_row.get(cid)
                    if row is None:
                        continue  # not yet embedded -- not a valid candidate
                    rows.append(row)
                    ids.append(cid)
                if not rows:
                    return []
                matrix = self._matrix()
                scores = matrix[rows] @ query
                order = np.argsort(-scores)[:top_k]
                return [(ids[i], float(scores[i])) for i in order]

            neighbors = self._neighbors.get(track_id, [])
            filtered = [(tid, score) for tid, score in neighbors if tid not in exclude_ids]
            return filtered[:top_k]

    def checkpoint(self) -> None:
        with self._lock:
            with open(self._checkpoint_path, "wb") as f:
                pickle.dump(
                    {"track_ids": self._track_ids, "vectors": self._vectors, "neighbors": self._neighbors},
                    f,
                )

    def _load_checkpoint_or_rebuild(self) -> None:
        if self._checkpoint_path.exists():
            try:
                with open(self._checkpoint_path, "rb") as f:
                    data = pickle.load(f)
                self._track_ids = data["track_ids"]
                self._vectors = data["vectors"]
                self._id_to_row = {tid: i for i, tid in enumerate(self._track_ids)}
                self._neighbors = data["neighbors"]
                return
            except Exception:
                pass  # corrupt/incompatible checkpoint -- fall through to rebuild
        self._rebuild_from_sidecars()

    def _rebuild_from_sidecars(self) -> None:
        self._track_ids = []
        self._id_to_row = {}
        self._vectors = []
        for shard_dir in self.tracks_dir.glob("*"):
            if not shard_dir.is_dir():
                continue
            for sidecar in shard_dir.glob("*.lfsv"):
                track_id = int(sidecar.stem)
                vector = self._read_sidecar(track_id)
                self._id_to_row[track_id] = len(self._track_ids)
                self._track_ids.append(track_id)
                self._vectors.append(vector)
        if self._track_ids:
            self.rebuild_graph()
            self.checkpoint()

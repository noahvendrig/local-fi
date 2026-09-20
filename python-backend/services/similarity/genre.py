"""Genre labels from Cnn14's AudioSet classifier head (see scripts/export_similarity_model.py --
`genre_probs` is the 527-class clipwise_output the similarity embedding export used to discard).
Used to backfill tracks.genre from the audio itself, since Spotify's artist `genres` field is
deprecated and returns nothing for any artist (see lib/spotify/enrichMatch.ts on the TS side).

AudioSet's ontology is a general-purpose sound-event taxonomy, not a music genre vocabulary, so
most of its 527 classes are irrelevant here (dog bark, door slam, etc.) and even within its
"Music genre" branch several entries are mood descriptors ("Happy music") or functional
categories ("Theme music", "Wedding music") rather than genres. GENRE_LABELS below is a hand-
picked subset of AudioSet class indices that are actual genres/styles, mapped to a display name.
Indices and source names are from class_labels_indices.csv (AudioSet's fixed 0-526 class
ordering, baked into Cnn14's output layer at training time -- this mapping is stable across any
Cnn14 checkpoint, not something that can drift).
"""
from __future__ import annotations

import numpy as np

from config import SIMILARITY_DATA_DIR

# Human-readable calibration log for CONFIDENCE_THRESHOLD/GENRE_LABELS tuning (see
# job_manager.py's write_genre_debug_line, called once per track during a similarity/genre
# backfill) -- NOT the source of truth for anything, tracks.genre in the SQLite DB is. Overwritten
# at the start of every job (see job_manager.py's _run_track_batch) rather than appended forever,
# so it always reflects just the most recent run -- which, since already-genred tracks drop out of
# eligibility between runs (see app/api/v1/similarity/jobs/route.ts), naturally converges toward
# "the tracks still worth looking at" as a library gets repeatedly backfilled over time.
GENRE_DEBUG_LOG_PATH = SIMILARITY_DATA_DIR / "genre_debug.log"
# How many of GENRE_LABELS' scores to show per track -- enough to see near-misses just under
# CONFIDENCE_THRESHOLD (useful for deciding whether to lower it), without dumping all ~47.
LOGGED_CANDIDATES = 8

# Cnn14's classifier head width -- fixed by the AudioSet ontology it was trained on (527 classes),
# baked into the ONNX export's genre_probs output shape.
NUM_GENRE_CLASSES = 527

# index -> display name. Deliberately excludes AudioSet's mood descriptors (Happy/Sad/Angry
# music, ...), functional categories (Background/Theme/Jingle/Soundtrack/Video game/Wedding
# music, Lullaby), and near-duplicates of "Music" itself (Song, Vocal music, A capella) -- none
# of those are a genre in the sense tracks.genre is used elsewhere (Spotify import, manual tags).
GENRE_LABELS: dict[int, str] = {
    216: "Pop",
    217: "Hip Hop",
    219: "Rock",
    220: "Heavy Metal",
    221: "Punk",
    222: "Grunge",
    223: "Progressive Rock",
    224: "Rock and Roll",
    225: "Psychedelic Rock",
    226: "R&B",
    227: "Soul",
    228: "Reggae",
    229: "Country",
    230: "Swing",
    231: "Bluegrass",
    232: "Funk",
    233: "Folk",
    234: "Middle Eastern",
    235: "Jazz",
    236: "Disco",
    237: "Classical",
    238: "Opera",
    239: "Electronic",
    240: "House",
    241: "Techno",
    242: "Dubstep",
    243: "Drum and Bass",
    244: "Electronica",
    245: "EDM",
    246: "Ambient",
    247: "Trance",
    248: "Latin",
    249: "Salsa",
    250: "Flamenco",
    251: "Blues",
    253: "New Age",
    256: "African",
    257: "Afrobeat",
    258: "Christian",
    259: "Gospel",
    260: "Asian",
    261: "Carnatic",
    262: "Bollywood",
    263: "Ska",
    264: "Traditional",
    265: "Indie",
    274: "Dance",
}

# Cnn14's clipwise_output is per-class sigmoid probability (AudioSet is multi-label), not a
# softmax distribution -- there's no "top-1 of 100%" to lean on, so this is a plain confidence
# floor. False negatives just leave genre null (same "skip, don't guess" contract as the old
# Spotify-based enrichment); false positives write a wrong, sticky genre tag that this pipeline
# will never overwrite once set. Lowered from the original 0.25 to 0.07 (2026-09-20) after
# reviewing genre_debug.log against this library: most tracks' top score sits in the 0.02-0.15
# range even for audibly-right genres (this is a general sound-event classifier repurposed for
# genre, not a model trained for it, so its confidence calibration runs low across the board) --
# 0.25 was leaving the large majority of the library at (none). 0.07 trades some of that
# conservatism for coverage; still well above the noise floor seen on clearly-wrong classes in the
# same log (typically < 0.03).
CONFIDENCE_THRESHOLD = 0.07
# AudioSet's genre classes overlap heavily by design (a house track fires House, Electronic, EDM,
# and Dance all at once) -- capped so the joined string reads like a genre tag, not a probability
# dump of every co-firing label. Raised from 3 to 5 alongside the threshold drop above: a lower
# threshold surfaces more co-firing classes per track, so the cap needed to move with it to still
# show them.
MAX_LABELS = 5


def scored_genre_candidates(genre_probs: np.ndarray) -> list[tuple[str, float]]:
    """Every GENRE_LABELS class for one track, highest confidence first, regardless of
    CONFIDENCE_THRESHOLD -- the full picture genre_probs_to_label's threshold cut then applies to.
    Exists as its own function (rather than folded into genre_probs_to_label) so callers that want
    to see what a track scored on classes that *didn't* clear the bar -- calibrating
    CONFIDENCE_THRESHOLD itself, e.g. genre_debug logging in job_manager.py -- have something to
    look at."""
    scored = [(name, float(genre_probs[idx])) for idx, name in GENRE_LABELS.items()]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored


def genre_probs_to_label(genre_probs: np.ndarray) -> str | None:
    """Turns one track's pooled (527,) AudioSet probability vector into a comma-joined genre
    string ("House, Electronic, Dance"), highest confidence first -- or None if nothing in
    GENRE_LABELS cleared CONFIDENCE_THRESHOLD."""
    scored = [(name, score) for name, score in scored_genre_candidates(genre_probs) if score >= CONFIDENCE_THRESHOLD]
    if not scored:
        return None
    return ", ".join(name for name, _ in scored[:MAX_LABELS])


def format_genre_debug_line(*, track_id: int, filename: str, chosen: str | None, candidates: list[tuple[str, float]]) -> str:
    """One line for GENRE_DEBUG_LOG_PATH: the chosen (thresholded) label plus the top
    LOGGED_CANDIDATES raw scores, marking which ones actually cleared CONFIDENCE_THRESHOLD (*) so
    it's visible at a glance how close a `chosen=(none)` track came, and how much headroom a
    chosen one had over the runner-up."""
    scored_str = ", ".join(
        f"{name}={score:.3f}{'*' if score >= CONFIDENCE_THRESHOLD else ''}" for name, score in candidates[:LOGGED_CANDIDATES]
    )
    return f"track={track_id:<6} chosen={chosen or '(none)':<40} {filename}\n    scores: {scored_str}\n"

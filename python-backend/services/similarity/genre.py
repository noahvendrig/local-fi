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
# floor. Picked conservatively: false negatives just leave genre null (same "skip, don't guess"
# contract as the old Spotify-based enrichment), false positives write a wrong, sticky genre tag
# that this pipeline will never overwrite once set.
CONFIDENCE_THRESHOLD = 0.25
# AudioSet's genre classes overlap heavily by design (a house track fires House, Electronic, EDM,
# and Dance all at once) -- capped so the joined string reads like a genre tag, not a probability
# dump of every co-firing label.
MAX_LABELS = 3


def genre_probs_to_label(genre_probs: np.ndarray) -> str | None:
    """Turns one track's pooled (527,) AudioSet probability vector into a comma-joined genre
    string ("House, Electronic, Dance"), highest confidence first -- or None if nothing in
    GENRE_LABELS cleared CONFIDENCE_THRESHOLD."""
    scored = [(genre_probs[idx], name) for idx, name in GENRE_LABELS.items() if genre_probs[idx] >= CONFIDENCE_THRESHOLD]
    if not scored:
        return None
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return ", ".join(name for _, name in scored[:MAX_LABELS])

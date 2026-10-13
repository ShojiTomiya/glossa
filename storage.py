import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

TEXTS_DIR = Path(__file__).parent / "texts"
INDEX_PATH = TEXTS_DIR / "index.json"

TEXTS_DIR.mkdir(exist_ok=True)

# Kinds stored as structured blocks (heading/paragraph/list-item/table-row +
# styled text runs) in a .json file, rather than the raw file.
# New EPUBs keep the original file instead; "epub" here covers older uploads.
BLOCK_KINDS = {"epub", "url"}


def _load_index() -> list:
    if not INDEX_PATH.exists():
        return []
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def _save_index(index: list) -> None:
    INDEX_PATH.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")


def _find(index: list, text_id: str) -> dict | None:
    return next((e for e in index if e["id"] == text_id), None)


def _save_original(title: str, source_lang: str, raw: bytes, kind: str) -> dict:
    # PDFs and EPUBs are kept as uploaded and rendered on request
    # (pdf_render.py, epub_render.py).
    text_id = uuid.uuid4().hex[:12]
    (TEXTS_DIR / f"{text_id}.{kind}").write_bytes(raw)

    entry = {
        "id": text_id,
        "title": title,
        "source_lang": source_lang,
        "kind": kind,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    index = _load_index()
    index.append(entry)
    _save_index(index)
    return entry


def save_pdf(title: str, source_lang: str, raw: bytes) -> dict:
    return _save_original(title, source_lang, raw, "pdf")


def save_epub(title: str, source_lang: str, raw: bytes) -> dict:
    return _save_original(title, source_lang, raw, "epub")


def save_blocks(title: str, source_lang: str, blocks: list, kind: str) -> dict:
    assert kind in BLOCK_KINDS, f"unknown block kind {kind!r}"
    text_id = uuid.uuid4().hex[:12]
    (TEXTS_DIR / f"{text_id}.json").write_text(json.dumps(blocks, ensure_ascii=False), encoding="utf-8")

    entry = {
        "id": text_id,
        "title": title,
        "source_lang": source_lang,
        "kind": kind,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    index = _load_index()
    index.append(entry)
    _save_index(index)
    return entry


def save_video(title: str, source_lang: str, video_id: str, segments: list, subtitle_source: str) -> dict:

    assert subtitle_source in ("manual", "auto"), f"unknown subtitle source {subtitle_source!r}"
    text_id = uuid.uuid4().hex[:12]
    (TEXTS_DIR / f"{text_id}.json").write_text(json.dumps(segments, ensure_ascii=False), encoding="utf-8")
    entry = {
        "id": text_id,
        "title": title,
        "source_lang": source_lang,
        "kind": "video",
        "video_id": video_id,
        "subtitle_source": subtitle_source,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    index = _load_index()
    index.append(entry)
    _save_index(index)
    return entry


def list_texts() -> list:
    return sorted(_load_index(), key=lambda e: e["created_at"], reverse=True)


def get_text(text_id: str) -> dict | None:
    index = _load_index()
    entry = _find(index, text_id)
    if entry is None:
        return None

    kind = entry.get("kind")
    if kind == "pdf":
        path = TEXTS_DIR / f"{text_id}.pdf"
        if not path.exists():
            return None
        return {**entry, "kind": "pdf"}

    # EPUBs uploaded before epub_render.py exist only as extracted blocks (.json, below).
    if kind == "epub" and (TEXTS_DIR / f"{text_id}.epub").exists():
        return {**entry, "kind": "epub"}

    if kind == "video":
        path = TEXTS_DIR / f"{text_id}.json"
        if not path.exists():
            return None
        return {**entry, "kind": "video", "segments": json.loads(path.read_text(encoding="utf-8"))}

    if kind in BLOCK_KINDS:
        path = TEXTS_DIR / f"{text_id}.json"
        if not path.exists():
            return None
        blocks = json.loads(path.read_text(encoding="utf-8"))
        return {**entry, "kind": kind, "blocks": blocks}

    return None


def _original_path(text_id: str, kind: str) -> Path | None:
    index = _load_index()
    entry = _find(index, text_id)
    if entry is None or entry.get("kind") != kind:
        return None
    path = TEXTS_DIR / f"{text_id}.{kind}"
    return path if path.exists() else None


def get_pdf_path(text_id: str) -> Path | None:
    return _original_path(text_id, "pdf")


def get_epub_path(text_id: str) -> Path | None:
    return _original_path(text_id, "epub")


def update_text(text_id: str, title: str, source_lang: str) -> dict | None:
    index = _load_index()
    entry = _find(index, text_id)
    if entry is None:
        return None
    entry["title"] = title
    if entry.get("kind") != "video":  # the subtitles were fetched in this language
        entry["source_lang"] = source_lang
    _save_index(index)
    return entry


def delete_text(text_id: str) -> bool:
    index = _load_index()
    entry = _find(index, text_id)
    new_index = [e for e in index if e["id"] != text_id]
    if len(new_index) == len(index):
        return False
    _save_index(new_index)

    kind = entry.get("kind") if entry else None
    if kind == "pdf":
        suffixes = [".pdf"]
    elif kind == "epub":
        suffixes = [".epub", ".json"]  # the original, or blocks from before epub_render.py
    else:  # url, video
        suffixes = [".json"]
    for suffix in suffixes:
        path = TEXTS_DIR / f"{text_id}{suffix}"
        if path.exists():
            path.unlink()
    return True

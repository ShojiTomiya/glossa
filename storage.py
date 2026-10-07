import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

TEXTS_DIR = Path(__file__).parent / "texts"
INDEX_PATH = TEXTS_DIR / "index.json"

TEXTS_DIR.mkdir(exist_ok=True)

# Kinds stored as structured blocks (heading/paragraph/list-item/table-row +
# styled text runs) in a .json file, rather than a plain .txt or the raw file.
BLOCK_KINDS = {"epub", "url"}


def _load_index() -> list:
    if not INDEX_PATH.exists():
        return []
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def _save_index(index: list) -> None:
    INDEX_PATH.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")


def _find(index: list, text_id: str) -> dict | None:
    return next((e for e in index if e["id"] == text_id), None)


def save_text(title: str, source_lang: str, content: str) -> dict:
    text_id = uuid.uuid4().hex[:12]
    (TEXTS_DIR / f"{text_id}.txt").write_text(content, encoding="utf-8")

    entry = {
        "id": text_id,
        "title": title,
        "source_lang": source_lang,
        "kind": "text",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    index = _load_index()
    index.append(entry)
    _save_index(index)
    return entry


def save_pdf(title: str, source_lang: str, raw: bytes) -> dict:
    text_id = uuid.uuid4().hex[:12]
    (TEXTS_DIR / f"{text_id}.pdf").write_bytes(raw)

    entry = {
        "id": text_id,
        "title": title,
        "source_lang": source_lang,
        "kind": "pdf",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    index = _load_index()
    index.append(entry)
    _save_index(index)
    return entry


def save_blocks(title: str, source_lang: str, blocks: list, kind: str = "epub") -> dict:
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

    # Entries saved before "kind" existed are all plain extracted text.
    kind = entry.get("kind", "text")
    if kind == "pdf":
        path = TEXTS_DIR / f"{text_id}.pdf"
        if not path.exists():
            return None
        return {**entry, "kind": "pdf"}

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

    path = TEXTS_DIR / f"{text_id}.txt"
    if not path.exists():
        return None
    return {**entry, "kind": "text", "content": path.read_text(encoding="utf-8")}


def get_pdf_path(text_id: str) -> Path | None:
    index = _load_index()
    entry = _find(index, text_id)
    if entry is None or entry.get("kind") != "pdf":
        return None
    path = TEXTS_DIR / f"{text_id}.pdf"
    return path if path.exists() else None


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

    kind = entry.get("kind", "text") if entry else "text"
    if kind == "pdf":
        suffix = ".pdf"
    elif kind in BLOCK_KINDS or kind == "video":
        suffix = ".json"
    else:
        suffix = ".txt"
    path = TEXTS_DIR / f"{text_id}{suffix}"
    if path.exists():
        path.unlink()
    return True

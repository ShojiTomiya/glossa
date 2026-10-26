import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

TEXTS_DIR = Path(__file__).parent / "texts"
INDEX_PATH = TEXTS_DIR / "index.json"

TEXTS_DIR.mkdir(exist_ok=True)

# What each kind keeps next to its index entry:
#   pdf, epub — the original file, rendered on request (pdf_render.py, epub_render.py)
#   url       — the article as structured blocks (heading/paragraph/list-item/
#               table-row/image + styled text runs) in .json, pictures in <id>.images/
#   video     — the subtitle cues in .json


def _load_index() -> list:
    if not INDEX_PATH.exists():
        return []
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def _save_index(index: list) -> None:
    # Written next to the index and then swapped in: a crash halfway through
    # a write leaves the old index intact instead of a cut-off one, which
    # would lose the whole library.
    tmp = INDEX_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, INDEX_PATH)


def _find(index: list, text_id: str) -> dict | None:
    return next((e for e in index if e["id"] == text_id), None)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _add_entry(text_id: str, kind: str, title: str, source_lang: str, **extra) -> dict:
    entry = {
        "id": text_id,
        "title": title,
        "source_lang": source_lang,
        "kind": kind,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }
    index = _load_index()
    index.append(entry)
    _save_index(index)
    return entry


def save_pdf(title: str, source_lang: str, raw: bytes, metrics: dict) -> dict:
    # `metrics`: pdf_render.analyze()'s measurements, kept so they aren't
    # worked out again (a pass over the whole document) on every server start.
    text_id = _new_id()
    (TEXTS_DIR / f"{text_id}.pdf").write_bytes(raw)
    return _add_entry(text_id, "pdf", title, source_lang, metrics=metrics)


def save_epub(title: str, source_lang: str, raw: bytes) -> dict:
    text_id = _new_id()
    (TEXTS_DIR / f"{text_id}.epub").write_bytes(raw)
    return _add_entry(text_id, "epub", title, source_lang)


def save_article(title: str, source_lang: str, blocks: list) -> dict:
    text_id = _new_id()
    (TEXTS_DIR / f"{text_id}.json").write_text(json.dumps(blocks, ensure_ascii=False), encoding="utf-8")
    return _add_entry(text_id, "url", title, source_lang)


def save_video(title: str, source_lang: str, video_id: str, segments: list, subtitle_source: str) -> dict:

    assert subtitle_source in ("manual", "auto"), f"unknown subtitle source {subtitle_source!r}"
    text_id = _new_id()
    (TEXTS_DIR / f"{text_id}.json").write_text(json.dumps(segments, ensure_ascii=False), encoding="utf-8")
    return _add_entry(text_id, "video", title, source_lang, video_id=video_id, subtitle_source=subtitle_source)


def list_texts() -> list:
    return sorted(_load_index(), key=lambda e: e["created_at"], reverse=True)


def get_text(text_id: str) -> dict | None:
    entry = _find(_load_index(), text_id)
    if entry is None:
        return None

    kind = entry.get("kind")
    if kind in ("pdf", "epub"):
        # The reader asks for pages / chapters separately.
        return entry if (TEXTS_DIR / f"{text_id}.{kind}").exists() else None

    path = TEXTS_DIR / f"{text_id}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if kind == "video":
        return {**entry, "segments": data}
    if kind == "url":
        return {**entry, "blocks": data}
    return None


def get_original(text_id: str, kind: str) -> tuple[Path, dict] | None:
    # The stored PDF/EPUB file and its index entry, if `text_id` is one of that kind.
    entry = _find(_load_index(), text_id)
    if entry is None or entry.get("kind") != kind:
        return None
    path = TEXTS_DIR / f"{text_id}.{kind}"
    return (path, entry) if path.exists() else None


def update_entry(text_id: str, **fields) -> None:
    index = _load_index()
    entry = _find(index, text_id)
    if entry is not None:
        entry.update(fields)
        _save_index(index)


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
    if entry is None:
        return False
    _save_index([e for e in index if e["id"] != text_id])

    kind = entry.get("kind")
    path = TEXTS_DIR / f"{text_id}.{kind if kind in ('pdf', 'epub') else 'json'}"
    if path.exists():
        path.unlink()
    return True

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

TEXTS_DIR = Path(__file__).parent / "texts"
INDEX_PATH = TEXTS_DIR / "index.json"

TEXTS_DIR.mkdir(exist_ok=True)


def _load_index() -> list:
    if not INDEX_PATH.exists():
        return []
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def _save_index(index: list) -> None:
    INDEX_PATH.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")


def save_text(title: str, source_lang: str, content: str) -> dict:
    text_id = uuid.uuid4().hex[:12]
    (TEXTS_DIR / f"{text_id}.txt").write_text(content, encoding="utf-8")

    entry = {
        "id": text_id,
        "title": title,
        "source_lang": source_lang,
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
    entry = next((e for e in index if e["id"] == text_id), None)
    if entry is None:
        return None
    path = TEXTS_DIR / f"{text_id}.txt"
    if not path.exists():
        return None
    return {**entry, "content": path.read_text(encoding="utf-8")}


def update_text(text_id: str, title: str, source_lang: str) -> dict | None:
    index = _load_index()
    entry = next((e for e in index if e["id"] == text_id), None)
    if entry is None:
        return None
    entry["title"] = title
    entry["source_lang"] = source_lang
    _save_index(index)
    return entry


def delete_text(text_id: str) -> bool:
    index = _load_index()
    new_index = [e for e in index if e["id"] != text_id]
    if len(new_index) == len(index):
        return False
    _save_index(new_index)
    path = TEXTS_DIR / f"{text_id}.txt"
    if path.exists():
        path.unlink()
    return True

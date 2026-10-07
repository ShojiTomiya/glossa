import glob
import json
import os
import re
import tempfile
from urllib.parse import parse_qs, urlparse

try:
    import yt_dlp
except ImportError:  # the rest of the app (texts, PDFs, ...) must still start without video support
    yt_dlp = None


class VideoError(Exception):

    def __init__(self, message: str, status_code: int = 502, code: str = "extraction_failed"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


# ---------------------------------------------------------------- link parsing

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}
_PATH_PREFIXES = {"embed", "shorts", "live", "v"}


def parse_video_id(text: str) -> str | None:

    text = (text or "").strip()
    if _ID_RE.match(text):
        return text
    if not re.match(r"^[a-z][a-z0-9+.-]*://", text, re.I):
        text = "https://" + text
    try:
        parsed = urlparse(text)
        host = (parsed.hostname or "").lower()
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None

    candidate = None
    parts = [p for p in parsed.path.split("/") if p]
    if host == "youtu.be":
        candidate = parts[0] if parts else None
    elif host in _YT_HOSTS:
        if parts == ["watch"]:
            candidate = (parse_qs(parsed.query).get("v") or [None])[0]
        elif len(parts) >= 2 and parts[0] in _PATH_PREFIXES:
            candidate = parts[1]
    return candidate if candidate and _ID_RE.match(candidate) else None


def canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


# ------------------------------------------------------------- track selection

def _is_translated(formats) -> bool:
    """YouTube's machine-translated tracks carry a tlang= query parameter."""
    for fmt in formats or []:
        if "tlang" in parse_qs(urlparse(fmt.get("url") or "").query):
            return True
    return False


def pick_track(info: dict, lang: str) -> tuple[str, str] | None:

    manual = {k: v for k, v in (info.get("subtitles") or {}).items() if k != "live_chat" and v}
    auto = info.get("automatic_captions") or {}

    if lang in manual:
        return lang, "manual"
    regional = sorted(k for k in manual if k.lower().startswith(f"{lang}-"))
    if regional:  # e.g. de-DE, es-419, en-GB
        return regional[0], "manual"

    if auto.get(f"{lang}-orig"):
        return f"{lang}-orig", "auto"
    if auto.get(lang) and not _is_translated(auto[lang]):
        return lang, "auto"
    return None


def _no_subtitles_message(info: dict, lang: str) -> str:
    manual = sorted(k for k in (info.get("subtitles") or {}) if k != "live_chat")
    auto = sorted(k[: -len("-orig")] for k in (info.get("automatic_captions") or {}) if k.endswith("-orig"))
    available = []
    if manual:
        available.append("manual: " + ", ".join(manual))
    if auto:
        available.append("auto-generated: " + ", ".join(auto))
    msg = f"This video has no subtitles in '{lang}'."
    if available:
        msg += " Available: " + "; ".join(available) + "."
    return msg + " Check the source language, or try another video."


# ----------------------------------------------------------------- json3 parse

_TAG_RE = re.compile(r"<[^>]+>")


def parse_json3(raw: bytes | str) -> list[dict]:

    data = json.loads(raw)
    cues = []
    for event in data.get("events") or []:
        segs = event.get("segs")
        if not segs or event.get("tStartMs") is None:
            continue  # window/style definitions carry no text
        text = _TAG_RE.sub("", "".join(s.get("utf8", "") for s in segs))
        text = " ".join(text.split())  # also folds the "\n" line-break segments
        if not text:
            continue
        start = max(0.0, event["tStartMs"] / 1000)
        duration = (event.get("dDurationMs") or 0) / 1000
        cues.append({"start": start, "end": start + duration, "text": text})
    return _normalize(cues)


def _normalize(cues: list[dict]) -> list[dict]:

    out: list[dict] = []
    for cue in sorted(cues, key=lambda c: c["start"]):
        prev = out[-1] if out else None
        if prev:
            overlaps = cue["start"] <= prev["end"] + 0.25
            if overlaps and cue["text"] == prev["text"]:
                prev["end"] = max(prev["end"], cue["end"])
                continue
            if overlaps and cue["text"].startswith(prev["text"]):  # caption grows in place
                prev["text"] = cue["text"]
                prev["end"] = max(prev["end"], cue["end"])
                continue
            if cue["start"] - prev["start"] < 0.05:  # two lines of one cue
                prev["text"] = f"{prev['text']} {cue['text']}"
                prev["end"] = max(prev["end"], cue["end"])
                continue
        out.append(dict(cue))

    for cur, nxt in zip(out, out[1:]):
        if cur["end"] > nxt["start"] or cur["end"] <= cur["start"]:
            cur["end"] = nxt["start"]
    if out and out[-1]["end"] <= out[-1]["start"]:
        out[-1]["end"] = out[-1]["start"] + 3.0

    for cue in out:
        cue["start"] = round(cue["start"], 2)
        cue["end"] = round(cue["end"], 2)
    return out


# --------------------------------------------------------------------- yt-dlp

class _Collector:
    """yt-dlp logger that keeps messages instead of printing them."""

    def __init__(self):
        self.warnings: list[str] = []

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        self.warnings.append(str(msg))

    def error(self, msg):
        self.warnings.append(str(msg))


def _ydl_opts(log: _Collector) -> dict:
    opts = {
        "logger": log,
        "noplaylist": True,
        "noprogress": True,
        "skip_download": True,
        "socket_timeout": 20,
        "ignore_no_formats_error": True,  # we only want metadata + subtitles
    }
    runtime = os.getenv("YTDLP_JS_RUNTIME", "").strip()
    if runtime:
        name, _, path = runtime.partition(":")
        opts["js_runtimes"] = {name.strip().lower(): ({"path": path.strip()} if path.strip() else {})}
    remote = [c.strip() for c in os.getenv("YTDLP_REMOTE_COMPONENTS", "").split(",") if c.strip()]
    if remote:
        opts["remote_components"] = remote
    return opts


def _extract(opts: dict, url: str, download: bool) -> dict | None:
    if yt_dlp is None:
        raise VideoError(
            'Video import needs yt-dlp, which is not installed on the server. '
            'Install it with: pip install "yt-dlp[default]" (then restart the server).',
            503, "ytdlp_missing")
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=download)


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_UNAVAILABLE = (
    "private video", "video unavailable", "this video is unavailable", "this video is not available",
    "has been removed", "has been terminated", "members-only", "not available in your country",
)


def _hint(log: _Collector) -> str:
    if any("javascript runtime" in w.lower() for w in log.warnings):
        return (" yt-dlp found no JavaScript runtime: install Deno, or set YTDLP_JS_RUNTIME "
                "(see the yt-dlp EJS wiki).")
    return ' If this keeps happening, update yt-dlp: pip install -U "yt-dlp[default]".'


def _to_video_error(exc: Exception, log: _Collector) -> VideoError:
    msg = re.sub(r"^ERROR:\s*", "", _ANSI_RE.sub("", str(exc)).strip())[:300]
    low = msg.lower()
    if any(s in low for s in _UNAVAILABLE):
        return VideoError("This video is unavailable (private, removed or region-blocked).", 404, "unavailable")
    if "sign in" in low or "confirm your age" in low or "age-restricted" in low:
        return VideoError(
            "YouTube wants a signed-in session for this video (age limit or bot check), "
            "so Glossa can't read its subtitles.", 422, "sign_in_required")
    if "429" in low or "too many requests" in low:
        return VideoError("YouTube is rate-limiting this server. Try again in a few minutes.", 503, "rate_limited")
    return VideoError(f"yt-dlp could not read this video: {msg}.{_hint(log)}", 502, "extraction_failed")


def _guarded(fn, log: _Collector):
    try:
        return fn()
    except VideoError:
        raise
    except Exception as exc:  # yt-dlp raises many unrelated types
        raise _to_video_error(exc, log) from exc


def _find_subtitle_file(info: dict | None, key: str, tmp_dir: str) -> str | None:
    path = (((info or {}).get("requested_subtitles") or {}).get(key) or {}).get("filepath")
    if path and os.path.exists(path):
        return path
    found = sorted(glob.glob(os.path.join(tmp_dir, "*.json3")))
    return found[0] if found else None


def fetch_subtitles(video_id: str, lang: str) -> dict:

    url = canonical_url(video_id)
    log = _Collector()

    # Both write flags are needed for yt-dlp to build the full automatic_captions
    # map; nothing is written to disk in this pass (download=False).
    probe = {**_ydl_opts(log), "writesubtitles": True, "writeautomaticsub": True}
    info = _guarded(lambda: _extract(probe, url, False), log)
    if not isinstance(info, dict):
        raise VideoError("yt-dlp returned no data for this video." + _hint(log), 502, "extraction_failed")

    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise VideoError("Live streams and premieres have no finished subtitles yet.", 422, "live")
    if info.get("playable_in_embed") is False:
        raise VideoError("The owner has disabled embedding for this video, so Glossa can't play it.",
                         422, "embedding_disabled")

    picked = pick_track(info, lang)
    if picked is None:
        raise VideoError(_no_subtitles_message(info, lang), 404, "no_subtitles")
    key, source = picked

    with tempfile.TemporaryDirectory(prefix="glossa-subs-") as tmp:
        opts = {
            **_ydl_opts(log),
            "writesubtitles": source == "manual",
            "writeautomaticsub": source == "auto",
            "subtitleslangs": [key],
            "subtitlesformat": "json3",
            "paths": {"home": tmp},
            "outtmpl": "%(id)s.%(ext)s",
        }
        downloaded = _guarded(lambda: _extract(opts, url, True), log)
        path = _find_subtitle_file(downloaded, key, tmp)
        if path is None:
            raise VideoError("YouTube did not return the subtitle file." + _hint(log), 502, "subtitles_download_failed")
        with open(path, "rb") as f:
            raw = f.read()

    try:
        segments = parse_json3(raw)
    except (ValueError, TypeError, AttributeError) as exc:
        raise VideoError("The subtitles came in an unexpected format." + _hint(log), 502, "subtitles_parse_failed") from exc
    if not segments:
        raise VideoError("The subtitle track is empty.", 404, "no_subtitles")

    return {
        "title": info.get("title") or video_id,
        "subtitle_source": source,
        "subtitle_key": key,
        "segments": segments,
    }

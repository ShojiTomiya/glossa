import glob
import logging
import os
import re
import shutil
import threading
from functools import lru_cache
from pathlib import Path

from phonemizer.backend import EspeakBackend
from phonemizer.backend.espeak.wrapper import EspeakWrapper

from config import LANGUAGES

log = logging.getLogger(__name__)

_lock = threading.Lock()

_WORD_RE = re.compile(r"[^\W\d_]+(?:['’\-][^\W\d_]+)*")

_LIB_PATTERNS = ("libespeak-ng*.dylib", "libespeak-ng*.so*", "libespeak-ng*.dll")


def _setup_library() -> None:
    """Point phonemizer to an eSpeak NG library, trying the most reliable source first."""
    if os.environ.get("PHONEMIZER_ESPEAK_LIBRARY"):
        return

    try:
        import espeakng_loader

        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
        return
    except ImportError:
        pass

    exe = shutil.which("espeak-ng")
    if exe:
        exe_path = Path(exe)
        for p in (exe_path, exe_path.resolve()):
            for directory in (p.parent, p.parent.parent / "lib"):
                for pattern in _LIB_PATTERNS:
                    found = sorted(directory.glob(pattern))
                    if found:
                        EspeakWrapper.set_library(str(found[0]))
                        return

    for pattern in (
        "/opt/homebrew/lib/libespeak-ng*.dylib",  # Homebrew on Apple Silicon
        "/usr/local/lib/libespeak-ng*.dylib",     # Homebrew on Intel Macs
        "C:/Program Files/eSpeak NG/libespeak-ng.dll",
        "C:/Program Files (x86)/eSpeak NG/libespeak-ng.dll",
    ):
        found = sorted(glob.glob(pattern))
        if found:
            EspeakWrapper.set_library(found[0])
            return

    log.warning("eSpeak NG library not found; IPA transcriptions will be empty")


_setup_library()


@lru_cache(maxsize=None)
def _backend(voice: str) -> EspeakBackend:
    return EspeakBackend(voice, with_stress=True, language_switch="remove-flags")


def _clean(text: str) -> str:
    return " ".join(_WORD_RE.findall(text or ""))


def add_phonetics(words, lang_code: str) -> None:

    if not isinstance(words, list):
        return
    words = [w for w in words if isinstance(w, dict)]
    if not words:
        return

    ipa = [""] * len(words)
    voice = LANGUAGES.get(lang_code, {}).get("espeak")
    if voice:
        cleaned = [_clean(w.get("text", "")) for w in words]
        try:
            with _lock:
                # Single batched call for the whole table.
                ipa = _backend(voice).phonemize(cleaned, strip=True)
        except Exception as e:
            log.warning("eSpeak failed: %s", e)

    for w, p in zip(words, ipa):
        p = (p or "").strip()
        w["phonetic"] = f"/{p}/" if p else ""
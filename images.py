import hashlib
import ipaddress
import logging
import re
import shutil
import socket
import ssl
import struct
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path
from urllib.parse import urljoin, urlparse

import storage

log = logging.getLogger(__name__)

MAX_IMAGES = 25
MAX_IMAGE_BYTES = 6 * 1024 * 1024
MAX_TOTAL_BYTES = 40 * 1024 * 1024
MIN_IMAGE_BYTES = 4 * 1024  # tracking pixels, spacers, tiny icons
MIN_WIDTH, MIN_HEIGHT = 120, 60
TIMEOUT_S = 10  # per network operation (connect, one read)
IMAGE_DEADLINE_S = 20.0  # for one image in total, however slowly the bytes arrive
TOTAL_DEADLINE_S = 45.0  # for all images of an article together
MAX_REDIRECTS = 3
WORKERS = 4

NAME_RE = re.compile(r"^[0-9a-f]{16}\.(?:jpg|png|gif|webp)$")
ID_RE = re.compile(r"^[0-9a-f]{12}$")  # what storage.py generates (uuid4().hex[:12])
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"


class ImageError(Exception):
    pass


# ----------------------------------------------------------------------- safety

def _is_public_host(host: str) -> bool:

    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError, OSError):
        return False
    if not infos:
        return False
    for info in infos:
        address = info[4][0].split("%", 1)[0]
        try:
            if not ipaddress.ip_address(address).is_global:
                return False
        except ValueError:
            return False
    return True


def _check_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ImageError("unsupported address")
    if not _is_public_host(parsed.hostname):
        raise ImageError("address is not public")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # surface the 3xx so that each hop can be checked by us


def _ssl_context() -> ssl.SSLContext:
    
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _read_limited(resp, deadline: float) -> bytes:
    
    declared = resp.headers.get("Content-Length")
    if declared and declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
        raise ImageError("too large")
    chunks, size = [], 0
    while True:
        if time.monotonic() > deadline:
            raise ImageError("too slow")
        chunk = resp.read(64 * 1024)
        if not chunk:
            return b"".join(chunks)
        size += len(chunk)
        if size > MAX_IMAGE_BYTES:
            raise ImageError("too large")
        chunks.append(chunk)


def _fetch(url: str, referer: str, deadline: float) -> bytes:
    opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=_ssl_context()))
    for _ in range(MAX_REDIRECTS + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ImageError("too slow")
        _check_url(url)
        request = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "image/jpeg,image/png,image/gif,image/webp,image/*;q=0.8",
            "Referer": referer,  # many image hosts only serve requests that come from the article
        })
        try:
            with opener.open(request, timeout=min(TIMEOUT_S, remaining)) as resp:
                return _read_limited(resp, deadline)
        except urllib.error.HTTPError as e:
            location = e.headers.get("Location") if e.headers else None
            if e.code in (301, 302, 303, 307, 308) and location:
                url = urljoin(url, location)
                continue
            raise ImageError(f"HTTP {e.code}") from e
    raise ImageError("too many redirects")


# ------------------------------------------------------------------ file checks

def sniff_extension(data: bytes) -> str | None:

    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def dimensions(data: bytes, ext: str) -> tuple[int, int] | None:

    try:
        if ext == "png" and len(data) >= 24:
            return struct.unpack(">II", data[16:24])
        if ext == "gif" and len(data) >= 10:
            return struct.unpack("<HH", data[6:10])
        if ext == "jpg":
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                length = struct.unpack(">H", data[i + 2:i + 4])[0]
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    height, width = struct.unpack(">HH", data[i + 5:i + 9])
                    return width, height
                i += 2 + length
    except (struct.error, IndexError):
        pass
    return None


def _file_name(url: str, ext: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16] + "." + ext


def download_image(url: str, referer: str) -> tuple[str, bytes] | None:
    """(stored file name, bytes), or None if the image is unusable for any reason."""
    try:
        data = _fetch(url, referer, time.monotonic() + IMAGE_DEADLINE_S)
    except Exception as e:  # network, TLS, malformed HTTP, odd URLs ...: any failure just skips this picture
        log.debug("skipping image %s: %r", url, e)
        return None
    ext = sniff_extension(data)
    if ext is None or len(data) < MIN_IMAGE_BYTES:
        return None
    size = dimensions(data, ext)
    if size and (size[0] < MIN_WIDTH or size[1] < MIN_HEIGHT):
        return None
    return _file_name(url, ext), data


# ---------------------------------------------------------------------- public

def localize(blocks: list[dict], referer: str) -> tuple[list[dict], dict[str, bytes]]:
    
    wanted = [b for b in blocks if b.get("kind") == "image" and b.get("src")]
    if not wanted:
        return blocks, {}
    try:
        urls = list(dict.fromkeys(b["src"] for b in wanted))[:MAX_IMAGES]
        pool = ThreadPoolExecutor(max_workers=WORKERS)
        futures = {url: pool.submit(download_image, url, referer) for url in urls}
        wait(futures.values(), timeout=TOTAL_DEADLINE_S)
        # Don't join: a thread stuck in a DNS lookup can't be interrupted, but it must not hold the import.
        pool.shutdown(wait=False, cancel_futures=True)
        results = {}
        for url, future in futures.items():
            if future.done() and not future.cancelled() and future.exception() is None:
                results[url] = future.result()
    except Exception:
        return [b for b in blocks if b.get("kind") != "image"], {}

    files: dict[str, bytes] = {}
    total = 0
    kept_urls = {}
    for url in urls:  # in page order, so the budget goes to the first images
        result = results.get(url)
        if not result:
            continue
        name, data = result
        if total + len(data) > MAX_TOTAL_BYTES:
            break
        total += len(data)
        files[name] = data
        kept_urls[url] = name

    out, seen = [], set()
    for block in blocks:
        if block.get("kind") != "image":
            out.append(block)
            continue
        name = kept_urls.get(block.get("src"))
        if name is None or name in seen:
            continue  # failed, over budget, or the same picture again
        seen.add(name)
        out.append({"kind": "image", "file": name, "alt": block.get("alt", ""), "caption": block.get("caption", "")})
    return out, files


def _dir(text_id: str) -> Path:
    return storage.TEXTS_DIR / f"{text_id}.images"


def save_images(text_id: str, files: dict[str, bytes]) -> None:
    if not files:
        return
    folder = _dir(text_id)
    folder.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        if NAME_RE.match(name):
            (folder / name).write_bytes(data)


def delete_images(text_id: str) -> None:
    if ID_RE.match(text_id):
        shutil.rmtree(_dir(text_id), ignore_errors=True)


def image_path(text_id: str, name: str) -> Path | None:

    if not ID_RE.match(text_id) or not NAME_RE.match(name):
        return None
    path = _dir(text_id) / name
    return path if path.is_file() else None

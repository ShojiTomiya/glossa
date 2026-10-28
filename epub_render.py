import posixpath
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree

from bs4 import BeautifulSoup, Comment, NavigableString

import images

# The book is kept as uploaded and rendered one chapter (spine document) at a
# time, into the same kind of blocks the other readers use. Only the book's
# structure and its italic/bold/alignment survive — its fonts, colours and
# margins don't, so the reader's own theme and font settings apply.

HTML_TYPES = {"application/xhtml+xml", "text/html"}
# Elements that start a new block; everything else is inline text.
BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "body", "center", "dd", "details", "div", "dl", "dt",
    "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li",
    "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead",
    "tr", "ul",
}
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
SKIP_TAGS = {"script", "style", "head", "title", "noscript", "template", "object", "iframe", "audio", "video", "math"}
# Invisible characters publishers leave in the text (soft hyphens, zero-width
# spaces, BOMs, word joiners): they break word selection and end up in the
# phrase sent for translation.
INVISIBLE_RE = re.compile("[­​⁠﻿]")
# A note reference: "1", "[12]", "*", "†", "A" as a link inside the book.
NOTE_TEXT_RE = re.compile(r"^[\[(]?[\w*†‡§¶]{1,3}[\])]?$")
# Pictures smaller than this (px) are ornaments, bullets or spacers.
MIN_IMAGE_SIDE = 40
# Text right under a picture, in the same container, up to this long is its caption.
CAPTION_MAX_CHARS = 300


class EpubError(ValueError):
    pass


# ------------------------------------------------------------------ package

def _attr_local(el: ElementTree.Element, name: str) -> str | None:
    # Attribute lookup ignoring its XML namespace.
    for key, value in el.attrib.items():
        if key.split("}")[-1] == name:
            return value
    return None


def _children(el: ElementTree.Element, name: str) -> list:
    return [c for c in el.iter() if c.tag.split("}")[-1] == name]


def _read_package(zf: zipfile.ZipFile) -> dict:
    try:
        container = ElementTree.fromstring(zf.read("META-INF/container.xml"))
        rootfile = next(_attr_local(r, "full-path") for r in _children(container, "rootfile"))
        opf = ElementTree.fromstring(zf.read(rootfile))
    except (KeyError, StopIteration, ElementTree.ParseError) as e:
        raise EpubError("This doesn't look like a valid EPUB file.") from e

    base = posixpath.dirname(rootfile)
    manifest = {}
    for item in _children(opf, "item"):
        href = _attr_local(item, "href")
        if not href:
            continue
        manifest[_attr_local(item, "id")] = {
            "path": posixpath.normpath(posixpath.join(base, unquote(href.split("#")[0]))),
            "type": (_attr_local(item, "media-type") or "").lower(),
            "properties": (_attr_local(item, "properties") or "").split(),
        }

    linear, nonlinear = [], []
    for ref in _children(opf, "itemref"):
        item = manifest.get(_attr_local(ref, "idref"))
        if item and item["type"] in HTML_TYPES and "nav" not in item["properties"]:
            (nonlinear if _attr_local(ref, "linear") == "no" else linear).append(item["path"])

    titles = [t.text.strip() for t in _children(opf, "title") if t.text and t.text.strip()]
    styles = [i["path"] for i in manifest.values() if i["type"] == "text/css"]
    # Documents marked non-linear (often the notes) still belong to the book: they go last.
    return {"spine": linear + nonlinear, "styles": styles, "title": titles[0] if titles else None}


# ---------------------------------------------------------------------- CSS

def _style_props(declarations: str) -> dict:
    props = {}
    for decl in declarations.split(";"):
        name, _, value = decl.partition(":")
        name, value = name.strip().lower(), value.strip().lower().replace("!important", "").strip()
        if name == "font-style":
            props["italic"] = value in ("italic", "oblique")
        elif name == "font-weight":
            props["bold"] = value in ("bold", "bolder") or (value.isdigit() and int(value) >= 600)
        elif name == "text-align" and value in ("center", "right", "left", "justify", "start", "end"):
            props["align"] = value if value in ("center", "right") else None
        elif name == "display" and value == "none" or name == "visibility" and value == "hidden":
            props["hidden"] = True
        elif name == "font-size":
            m = re.match(r"([\d.]+)(em|rem|%)$", value)
            if value in ("small", "smaller", "x-small", "xx-small"):
                props["small"] = True
            elif m:
                size = float(m.group(1)) / (100 if m.group(2) == "%" else 1)
                props["small"] = size < 0.9
    return props


def _drop_print_rules(text: str) -> str:
    # "@media print { ... }" hides things on paper only; other @media blocks
    # are unwrapped, their rules kept.
    out, i = [], 0
    while (start := text.find("@media", i)) != -1:
        open_at = text.find("{", start)
        if open_at == -1:
            break
        depth, end = 1, open_at + 1
        while end < len(text) and depth:
            depth += {"{": 1, "}": -1}.get(text[end], 0)
            end += 1
        query = text[start + 6:open_at].lower()
        out.append(text[i:start])
        if not ("print" in query and "screen" not in query):
            out.append(text[open_at + 1:end - 1])
        i = end
    out.append(text[i:])
    return "".join(out)


def _parse_css(text: str) -> dict[str, dict]:
    # Only rules for a single simple selector ("p", ".poem", "span.i2") are
    # used: anything with a descendant/child part would need real matching.
    rules: dict[str, dict] = {}
    text = _drop_print_rules(re.sub(r"/\*.*?\*/", "", text, flags=re.S))
    for selectors, body in re.findall(r"([^{}@]+)\{([^{}]*)\}", text):
        props = _style_props(body)
        if not props:
            continue
        for selector in selectors.split(","):
            selector = selector.strip().lower()
            if re.fullmatch(r"[a-z0-9]*(\.[\w-]+)*", selector) and selector:
                rules.setdefault(selector, {}).update(props)
    return rules


# ------------------------------------------------------------------- blocks

def _clean(text: str) -> str:
    return INVISIBLE_RE.sub("", text)


def _merge_runs(runs: list[dict]) -> list[dict]:
    # Whitespace collapsed the way a browser would (also across runs and
    # around line breaks), block edges trimmed, and neighbouring runs with
    # the same style joined. "\n" runs are <br>s; "pre" text keeps its spaces.
    out: list[dict] = []
    for run in runs:
        text = run["text"]
        if not run.get("br") and not run.get("pre"):
            text = re.sub(r"\s+", " ", text)
        if not text:
            continue
        run = {**run, "text": text}
        last = out[-1] if out else None
        if last and not run.get("br") and not last.get("br") and not run.get("note") and not last.get("note") \
                and (last["italic"], last["bold"], last.get("pre")) == (run["italic"], run["bold"], run.get("pre")):
            last["text"] += text
        else:
            out.append(run)

    after_space = True  # trims the start of the block
    for run in out:
        if run.get("note"):
            after_space = False
        elif run.get("br"):
            after_space = True
        else:
            if after_space and not run.get("pre"):
                run["text"] = run["text"].lstrip(" ")
            after_space = run["text"].endswith(" ") if run["text"] else after_space
    for i, run in enumerate(out):
        before_break = i + 1 == len(out) or out[i + 1].get("br")
        if before_break and not run.get("note") and not run.get("pre") and not run.get("br"):
            run["text"] = run["text"].rstrip(" ")

    out = [r for r in out if r["text"]]
    while out and out[0].get("br"):
        out.pop(0)
    while out and out[-1].get("br"):
        out.pop()
    out = [{k: v for k, v in r.items() if k not in ("pre", "br")} for r in out]
    return out


class _ChapterParser:

    def __init__(self, zf: zipfile.ZipFile, doc_path: str, css: dict[str, dict]):
        self.zf = zf
        self.doc_path = doc_path
        self.css = css
        self.blocks: list[dict] = []

    # -- style lookup

    def _props(self, el) -> dict:
        props = {}
        tag = el.name
        classes = [c.lower() for c in el.get("class") or []]
        for selector in [tag] + [f".{c}" for c in classes] + [f"{tag}.{c}" for c in classes]:
            props.update(self.css.get(selector, {}))
        if el.get("style"):
            props.update(_style_props(el["style"]))
        return props

    @staticmethod
    def _semantic(el, *names) -> bool:
        kinds = (el.get("epub:type") or "").split() + (el.get("role") or "").replace("doc-", "").split()
        return any(n in kinds for n in names)

    def _is_page_number(self, el) -> bool:
        classes = " ".join(el.get("class") or []).lower()
        return self._semantic(el, "pagebreak") or any(s in classes for s in ("pagenum", "page-num", "pageno"))

    def _is_navigation(self, el) -> bool:
        # The book's own contents / list of illustrations: the reader moves
        # through the book itself, and their page numbers mean nothing here.
        return el.name == "nav" or self._semantic(el, "toc", "loi", "lot", "landmarks", "page-list")

    def _is_note_ref(self, el) -> bool:
        if el.name != "a" or not (el.get("href") or "").count("#"):
            return False
        if self._semantic(el, "noteref"):
            return True
        return bool(NOTE_TEXT_RE.match(el.get_text().strip()))

    def _is_footnote(self, el) -> bool:
        classes = " ".join(el.get("class") or []).lower()
        return self._semantic(el, "footnote", "endnote", "rearnote", "footnotes", "endnotes") or \
            "footnote" in classes or el.name == "aside"

    # -- pictures

    def _image_block(self, el) -> dict | None:
        src = el.get("src") or el.get("xlink:href") or el.get("href")
        if not src or src.startswith("data:"):
            return None
        path = posixpath.normpath(posixpath.join(posixpath.dirname(self.doc_path), unquote(src.split("#")[0].split("?")[0])))
        try:
            data = self.zf.read(path)
        except KeyError:
            return None
        ext = images.sniff_extension(data)
        if ext is None:
            return None  # SVG and odd formats aren't served, as for article pictures
        size = images.dimensions(data, ext)
        if size and min(size) < MIN_IMAGE_SIDE:
            return None
        block = {"kind": "image", "src": path, "alt": (el.get("alt") or "").strip()}
        if size:
            block["width"], block["height"] = size
        return block

    # -- walking

    def parse(self, soup) -> list[dict]:
        root = soup.body or soup
        self._walk(root, {"kind": "paragraph"}, {"italic": False, "bold": False})
        return self.blocks

    def _flush(self, runs: list, info: dict) -> None:
        merged = _merge_runs(runs)
        runs.clear()
        if merged and any(r["text"].strip() for r in merged if not r.get("note")):
            block = {k: v for k, v in info.items() if v is not None and v is not False}
            block["runs"] = merged
            self.blocks.append(block)

    def _block_info(self, el, parent: dict) -> dict:
        props = self._props(el)
        info = {
            "kind": "paragraph",
            "align": props.get("align", parent.get("align")),
            "quote": parent.get("quote") or el.name == "blockquote",
            "small": props.get("small", parent.get("small")) or self._is_footnote(el) or parent.get("small"),
            "pre": parent.get("pre") or el.name == "pre",
        }
        if el.name in HEADING_TAGS:
            info["kind"], info["level"] = "heading", int(el.name[1])
        elif el.name == "li":
            info["kind"] = "list-item"
        elif el.name in ("td", "th", "tr"):
            info["kind"] = "table-row"
        return info

    def _walk(self, el, info: dict, style: dict) -> None:
        # Collects inline text of `el` into runs; a nested block flushes what's
        # collected so far as one block and is walked on its own, so text
        # sitting next to nested blocks isn't lost.
        runs: list[dict] = []
        self._walk_children(el, info, style, runs)
        self._flush(runs, info)

    def _walk_children(self, el, info: dict, style: dict, runs: list) -> None:
        for child in el.children:
            if isinstance(child, Comment):
                continue
            if isinstance(child, NavigableString):
                text = _clean(str(child))
                if text:
                    runs.append({"text": text, **style, "pre": bool(info.get("pre"))})
                continue
            name = child.name
            if name in SKIP_TAGS or self._is_page_number(child) or self._is_navigation(child):
                continue
            props = self._props(child)
            if props.get("hidden"):
                continue

            if name == "br":
                runs.append({"text": "\n", **style, "br": True})
            elif name == "img" or name == "image":
                image = self._image_block(child)
                if image:
                    self._flush(runs, info)
                    self.blocks.append(image)
            elif name == "svg":
                for image_el in child.find_all("image"):
                    image = self._image_block(image_el)
                    if image:
                        self._flush(runs, info)
                        self.blocks.append(image)
            elif name == "hr":
                self._flush(runs, info)
                self.blocks.append({"kind": "separator"})
            elif name == "tr":
                self._flush(runs, info)
                self._table_row(child, self._block_info(child, info), style)
            elif name in BLOCK_TAGS or child.find(list(BLOCK_TAGS)) is not None:
                self._flush(runs, info)
                child_style = {
                    "italic": props.get("italic", style["italic"]),
                    "bold": props.get("bold", style["bold"]) and name not in HEADING_TAGS,
                }
                start = len(self.blocks)
                self._walk(child, self._block_info(child, info), child_style)
                self._attach_caption(start)
            elif self._is_note_ref(child):
                mark = re.sub(r"[\[\]()]", "", child.get_text().strip())
                runs.append({"text": mark, "italic": False, "bold": False, "note": True})
            else:
                child_style = {
                    "italic": props.get("italic", style["italic"] or name in ("i", "em", "cite", "var", "dfn")),
                    "bold": props.get("bold", style["bold"] or name in ("b", "strong")),
                }
                self._walk_children(child, info, child_style, runs)

    def _attach_caption(self, start: int) -> None:
        # A picture and the short text under it in one container (<figure>,
        # Gutenberg's div.figcenter) become one block: the reader then never
        # puts a page break between a picture and its caption.
        produced = self.blocks[start:]
        if len(produced) < 2 or produced[0]["kind"] != "image" or "caption" in produced[0]:
            return
        rest = produced[1:]
        if len(rest) > 2 or any(b["kind"] != "paragraph" for b in rest):
            return
        if sum(len(r["text"]) for b in rest for r in b["runs"]) > CAPTION_MAX_CHARS:
            return
        caption: list[dict] = []
        for block in rest:
            if caption:
                caption.append({"text": "\n", "italic": False, "bold": False})
            caption.extend(block["runs"])
        produced[0]["caption"] = caption
        del self.blocks[start + 1:]

    def _table_row(self, tr, info: dict, style: dict) -> None:
        # Cells joined with an em dash on one line, as for article tables.
        runs: list[dict] = []
        for cell in tr.find_all(["td", "th"], recursive=False):
            cell_runs: list[dict] = []
            self._walk_children(cell, info, style, cell_runs)
            cell_runs = _merge_runs(cell_runs)
            if not any(r["text"].strip() for r in cell_runs):
                continue
            if runs:
                runs.append({"text": " — ", "italic": False, "bold": False})
            runs.extend(cell_runs)
        self._flush(runs, {**info, "kind": "table-row"})


# --------------------------------------------------------------------- book

def _is_contents_page(blocks: list[dict], soup) -> bool:
    # A table-of-contents page (mostly links to the book's own chapters):
    # the reader moves through the book itself, so it's skipped.
    # Links inside a marked-up contents list don't count: that list is
    # already left out, and the rest of the page (say, a copyright line) stays.
    links = [a for a in soup.find_all("a", href=True)
             if not a["href"].startswith(("http:", "https:", "mailto:"))
             and a.find_parent(lambda el: el.name == "nav" or "toc" in (el.get("epub:type") or "")
                               or "doc-toc" in (el.get("role") or "")) is None]
    text = "".join(r["text"] for b in blocks for r in b.get("runs", []))
    linked = sum(len(a.get_text().strip()) for a in links)
    return len(links) >= 5 and text.strip() != "" and linked >= len(text.strip()) * 0.6


BOOK_CACHE_SIZE = 3
_book_cache: dict[str, tuple[float, dict]] = {}


def _parse(path: str) -> dict:
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as e:
        raise EpubError("This doesn't look like a valid EPUB file.") from e
    with zf:
        package = _read_package(zf)
        css: dict[str, dict] = {}
        for style_path in package["styles"]:
            try:
                css.update(_parse_css(zf.read(style_path).decode("utf-8", errors="replace")))
            except KeyError:
                continue

        chapters = []
        for doc_path in package["spine"]:
            try:
                html = zf.read(doc_path)
            except KeyError:
                continue
            soup = BeautifulSoup(html, "html.parser")
            doc_css = dict(css)
            for style_el in soup.find_all("style"):
                doc_css.update(_parse_css(style_el.get_text()))
            blocks = _ChapterParser(zf, doc_path, doc_css).parse(soup)
            if not blocks or _is_contents_page(blocks, soup):
                continue
            chapters.append(blocks)

    if not any(b["kind"] != "image" for blocks in chapters for b in blocks):
        raise EpubError("EPUB has no extractable text content.")
    # Characters per chapter, for the reader's "how far into the book" figure.
    lengths = [sum(len(r["text"]) for b in blocks for r in b.get("runs", [])) + 1 for blocks in chapters]
    return {"title": package["title"], "chapters": chapters, "lengths": lengths}


def _load(path: str) -> dict:
    mtime = Path(path).stat().st_mtime
    cached = _book_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    book = _parse(path)
    # A few books are enough (the open one, and one switched away from).
    while len(_book_cache) >= BOOK_CACHE_SIZE:
        _book_cache.pop(next(iter(_book_cache)))
    _book_cache[path] = (mtime, book)
    return book


def inspect(path: str) -> dict:
    # Upload-time check; raises EpubError when there's nothing to read. Not
    # cached: the upload's temporary file is gone right after.
    book = _parse(path)
    return {"title": book["title"], "chapters": len(book["chapters"])}


def render_chapter(path: str, chapter: int) -> dict:
    """chapter is 1-indexed."""
    book = _load(path)
    chapters, lengths = book["chapters"], book["lengths"]
    if not 1 <= chapter <= len(chapters):
        raise EpubError(f"Chapter {chapter} out of range (book has {len(chapters)} chapters)")
    total = sum(lengths)
    return {
        # The same keys as a PDF's reading-mode parts: one paged reader shows both.
        "part": chapter,
        "total_parts": len(chapters),
        # Share of the book before this chapter, and this chapter's own share.
        "progress": {"before": sum(lengths[:chapter - 1]) / total, "share": lengths[chapter - 1] / total},
        "blocks": chapters[chapter - 1],
    }


def read_image(path: str, member: str) -> tuple[bytes, str]:
    # Only pictures the chapters actually show, so the endpoint can't be used
    # to read arbitrary files out of the book (its HTML, scripts, ...).
    shown = {b["src"] for blocks in _load(path)["chapters"] for b in blocks if b["kind"] == "image"}
    if member not in shown:
        raise EpubError("Image not found")
    with zipfile.ZipFile(path) as zf:
        data = zf.read(member)
    ext = images.sniff_extension(data)
    if ext is None:
        raise EpubError("Image not found")
    return data, {"jpg": "image/jpeg"}.get(ext, f"image/{ext}")

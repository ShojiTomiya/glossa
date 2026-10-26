import statistics

import fitz

FLAG_ITALIC = 2
FLAG_BOLD = 16

# Blocks that end above (or start below) this share of the page height are
# running headers / footers: read first (or last), outside any column.
MARGIN_ZONE = 0.08
# Side-by-side groups narrower than this share of the text width (a page
# number, a table-of-contents number column) aren't columns of text.
MIN_COLUMN_SHARE = 0.2
# Pictures with a side shorter than this (in PDF points) are rules, bullets
# or ornaments, not content.
MIN_IMAGE_SIDE = 16
# Wider pictures (share of the text width) never float beside text.
MAX_FLOAT_SHARE = 0.6
# A picture as wide as the text gets about this many pixels (twice the widest
# reader column, so it stays sharp on HiDPI screens); no side goes over the cap.
IMAGE_FULL_WIDTH_PX = 1800
IMAGE_MAX_PX = 2400


def _lines_same_row(a: dict, b: dict) -> bool:

    ay0, ay1 = a["bbox"][1], a["bbox"][3]
    by0, by1 = b["bbox"][1], b["bbox"][3]
    a_center, b_center = (ay0 + ay1) / 2, (by0 + by1) / 2
    tolerance = min(ay1 - ay0, by1 - by0) * 0.5
    return abs(a_center - b_center) <= tolerance


def _group_rows(lines: list) -> list[list]:

    rows: list[list] = []
    for line in sorted(lines, key=lambda l: l["bbox"][1]):
        for row in rows:
            if any(_lines_same_row(line, other) for other in row):
                row.append(line)
                break
        else:
            rows.append([line])
    for row in rows:
        row.sort(key=lambda l: l["bbox"][0])
    return rows


def _runs(spans: list, block_italic: bool) -> list[dict]:
    return [
        {"text": s["text"], "italic": bool(s["flags"] & FLAG_ITALIC) and not block_italic}
        for s in spans
        if s["text"]
    ]


def analyze(path: str) -> dict | None:
    # Measurements every page is rendered against, for the whole document (a
    # single page — a picture with a short caption — says little): the body
    # text's font size and the width of its text area. None when the PDF has
    # no text at all (a scan). Run once at upload; storage.py keeps the result.

    votes: dict[float, int] = {}
    pages: list[list[tuple[float, float, float]]] = []
    page_widths = []
    with fitz.open(path) as doc:
        for page in doc:
            page_widths.append(page.rect.width)
            lines = []
            # Text only: the picture bytes aren't needed here.
            d = page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)
            for block in d["blocks"]:
                if block.get("type") != 0:
                    continue
                for line in block["lines"]:
                    spans = [s for s in line["spans"] if s["text"].strip()]
                    if not spans:
                        continue
                    for span in spans:
                        key = round(span["size"], 1)
                        votes[key] = votes.get(key, 0) + len(span["text"])
                    size = max(spans, key=lambda s: len(s["text"]))["size"]
                    lines.append((size, line["bbox"][0], line["bbox"][2]))
            pages.append(lines)

    if not votes:
        return None
    body_size = max(votes, key=votes.get)

    # Per page (mirrored margins shift the text left/right between pages),
    # then the typical page.
    widths = []
    for lines in pages:
        body = [(x0, x1) for size, x0, x1 in lines if abs(size - body_size) <= body_size * 0.05]
        if len(body) >= 3:
            widths.append(max(x1 for _, x1 in body) - min(x0 for x0, _ in body))
    if widths:
        text_width = statistics.median(widths)
    else:
        text_width = statistics.median(page_widths) * 0.75

    return {"body_size": body_size, "text_width": text_width}


def _x_overlap(a, b) -> bool:
    return min(a[2], b[2]) > max(a[0], b[0])


def _y_overlap(a, b) -> bool:
    return min(a[3], b[3]) > max(a[1], b[1])


def _union(blocks: list) -> tuple:
    return (min(b["bbox"][0] for b in blocks), min(b["bbox"][1] for b in blocks),
            max(b["bbox"][2] for b in blocks), max(b["bbox"][3] for b in blocks))


def _is_wide(block: dict, blocks: list) -> bool:
    # Reaches over two blocks that sit side by side (like a title over two
    # columns): such blocks split the page into bands read top to bottom.
    under = [o for o in blocks if o is not block and _x_overlap(block["bbox"], o["bbox"])]
    return any(not _x_overlap(p["bbox"], q["bbox"]) for i, p in enumerate(under) for q in under[i + 1:])


def _order_band(blocks: list, text_width: float, columns: list) -> list:
    # Blocks overlapping horizontally form a column; columns next to each
    # other (overlapping vertically) are read left to right, each top to
    # bottom. Anything that doesn't look like real columns of text keeps the
    # plain top-to-bottom order.

    clusters: list[list] = []
    for block in sorted(blocks, key=lambda b: b["bbox"][0]):
        for cluster in clusters:
            if any(_x_overlap(block["bbox"], o["bbox"]) for o in cluster):
                cluster.append(block)
                break
        else:
            clusters.append([block])

    rows: list[dict] = []
    for cluster in sorted(clusters, key=lambda c: _union(c)[1]):
        box = _union(cluster)
        if rows and _y_overlap(rows[-1]["box"], box):
            row = rows[-1]
            row["clusters"].append(cluster)
            row["box"] = (min(row["box"][0], box[0]), min(row["box"][1], box[1]),
                          max(row["box"][2], box[2]), max(row["box"][3], box[3]))
        else:
            rows.append({"clusters": [cluster], "box": box})

    ordered = []
    for row in rows:
        clusters = row["clusters"]
        boxes = [_union(c) for c in clusters]
        if len(clusters) > 1 and all(b[2] - b[0] >= text_width * MIN_COLUMN_SHARE for b in boxes):
            for cluster, box in sorted(zip(clusters, boxes), key=lambda cb: cb[1][0]):
                cluster.sort(key=lambda b: b["bbox"][1])
                ordered.extend(cluster)
                columns.append({"box": box, "blocks": cluster})
        else:
            ordered.extend(sorted((b for c in clusters for b in c), key=lambda b: (b["bbox"][1], b["bbox"][0])))
    return ordered


def _reading_order(blocks: list, page_h: float, text_width: float) -> tuple[list, list, set]:
    # Returns the text blocks in reading order, the columns found
    # ({"box", "blocks"}), which decide where pictures inside a column go,
    # and the ids of the running header/footer blocks.

    def by_position(b):
        return b["bbox"][1], b["bbox"][0]

    header = [b for b in blocks if b["bbox"][3] < page_h * MARGIN_ZONE]
    footer = [b for b in blocks if b["bbox"][1] > page_h * (1 - MARGIN_ZONE) and b["bbox"][3] >= page_h * MARGIN_ZONE]
    edge = {id(b) for b in header + footer}
    body = [b for b in blocks if id(b) not in edge]

    wide = sorted((b for b in body if _is_wide(b, body)), key=by_position)
    wide_ids = {id(b) for b in wide}
    bands: list[list] = [[] for _ in range(len(wide) + 1)]
    for block in body:
        if id(block) in wide_ids:
            continue
        center = (block["bbox"][1] + block["bbox"][3]) / 2
        bands[sum(1 for w in wide if (w["bbox"][1] + w["bbox"][3]) / 2 < center)].append(block)

    columns: list[dict] = []
    ordered = sorted(header, key=by_position)
    for i, band in enumerate(bands):
        ordered.extend(_order_band(band, text_width, columns))
        if i < len(wide):
            ordered.append(wide[i])
    ordered.extend(sorted(footer, key=by_position))
    return ordered, columns, edge


def _is_content_image(block: dict, page, texts: list) -> bool:

    r = fitz.Rect(block["bbox"]) & page.rect
    if r.is_empty or r.width < MIN_IMAGE_SIDE or r.height < MIN_IMAGE_SIDE:
        return False
    if r.get_area() > page.rect.get_area() * 0.5:
        # A page-sized picture with text on top is a background, or a scan
        # under its OCR layer — not an illustration.
        if any(r.intersects(fitz.Rect(line["bbox"])) for b in texts for line in b["lines"]):
            return False
    block["bbox"] = tuple(r)
    return True


def _beside(line_box, r) -> bool:
    # On the same height as the picture (most of the line) and left or right of it.
    overlap = min(line_box[3], r[3]) - max(line_box[1], r[1])
    return overlap >= (line_box[3] - line_box[1]) * 0.5 and not _x_overlap(line_box, r)


def _place_images(pictures: list, ordered: list, columns: list, text_width: float) -> dict[int, list]:
    # Each picture goes right before a text block (keyed by its position in
    # `ordered`; len(ordered) = after the last one). A picture with text
    # beside it floats next to the first paragraph that text belongs to, the
    # way the page wraps text around it; otherwise it stands on its own
    # before the text below it.

    position = {id(b): i for i, b in enumerate(ordered)}
    in_columns = {id(b) for c in columns for b in c["blocks"]}
    flow = [b for b in ordered if id(b) not in in_columns]

    placed = []
    for pic in pictures:
        r = pic["bbox"]
        pic_w = r[2] - r[0]
        # Inside one column: only that column's text counts, not the column next to it.
        column = next((c for c in columns if _y_overlap(c["box"], r)
                       and min(r[2], c["box"][2]) - max(r[0], c["box"][0]) >= pic_w * 0.8), None)
        pool = column["blocks"] if column else flow
        region = column["box"] if column else (_union(pool) if pool else r)

        share = min(pic_w / text_width, 1.0)
        beside = [b for b in pool if any(_beside(line["bbox"], r) for line in b["lines"])]
        if beside and share <= MAX_FLOAT_SHARE:
            anchor = min(position[id(b)] for b in beside)
            side = "left" if (r[0] + r[2]) / 2 < (region[0] + region[2]) / 2 else "right"
        else:
            side = None
            below = [position[id(b)] for b in pool if b["bbox"][1] >= (r[1] + r[3]) / 2]
            if below:
                anchor = min(below)
            elif pool:
                anchor = max(position[id(b)] for b in pool) + 1
            else:
                anchor = len(ordered)
        placed.append((anchor, side, pic, share))

    # Pictures sharing a paragraph: standalone first, then left floats left
    # to right, right floats right to left (the order CSS lines floats up).
    def sort_key(item):
        anchor, side, pic, _ = item
        x = pic["bbox"][0]
        return anchor, side is not None, pic["bbox"][1] if side is None else (x if side == "left" else -x)

    by_anchor: dict[int, list] = {}
    floats: list[tuple] = []
    for anchor, side, pic, share in sorted(placed, key=sort_key):
        x0, y0, x1, y1 = pic["bbox"]
        # A float under another one on the same side has to start below it,
        # not squeeze in next to it.
        clear = side is not None and any(
            s == side and _x_overlap(b, pic["bbox"]) and not _y_overlap(b, pic["bbox"]) for s, b in floats)
        if side:
            floats.append((side, pic["bbox"]))
        by_anchor.setdefault(anchor, []).append({
            "id": f"{pic['page']}-{pic['index']}",
            "kind": "image",
            "index": pic["index"],
            "float": side,
            "clear": clear,
            "width": round(share * 100, 1),
            "aspect": round((x1 - x0) / (y1 - y0), 4),
        })
    return by_anchor


def _text_block_data(block: dict, page_num: int, area: tuple[float, float], body_size: float,
                     wrapped: bool) -> dict:
    # `area` is the horizontal span the alignment is judged in: the page, or
    # the block's column. `wrapped`: text runs beside a picture, so its
    # indented lines don't make it right-aligned.

    all_spans = [s for line in block["lines"] for s in line["spans"]]
    rep = max(all_spans, key=lambda s: len(s["text"]))
    rel_size = round(rep["size"] / body_size, 2) if body_size else 1.0
    is_bold = bool(rep["flags"] & FLAG_BOLD)
    is_italic = bool(rep["flags"] & FLAG_ITALIC)
    r, g, b = (rep["color"] >> 16) & 255, (rep["color"] >> 8) & 255, rep["color"] & 255
    is_muted = (r, g, b) != (0, 0, 0) and max(r, g, b) - min(r, g, b) < 20 and r > 40

    bx0, by0, bx1, by1 = block["bbox"]
    block_w = bx1 - bx0
    area_w = area[1] - area[0]
    left_margin, right_margin = bx0 - area[0], area[1] - bx1
    # Real typesetting rarely centers text pixel-perfectly (e.g. a
    # page number anchored at a fixed start point sits slightly
    # further right once it grows from 1 to 2 digits) — a generous
    # tolerance avoids such minor asymmetry reading as "left".
    if wrapped:
        align = "left"
    elif block_w < area_w * 0.6 and abs(left_margin - right_margin) < area_w * 0.15:
        align = "center"
    elif right_margin < left_margin * 0.5:
        align = "right"
    else:
        align = "left"

    rows = _group_rows(block["lines"])
    kind = "paragraph" if all(len(row) == 1 for row in rows) else "rows"

    return {
        "id": f"{page_num}-{block['index']}",
        "kind": kind,
        "align": align,
        "rel_size": rel_size,
        "bold": is_bold,
        "muted": is_muted,
        "rows": [
            {"cells": [_runs(line["spans"], is_italic) for line in row]}
            for row in rows
        ],
    }


def render_page(path: str, page_num: int, metrics: dict) -> dict:
    """page_num is 1-indexed; metrics from analyze()."""
    with fitz.open(path) as doc:
        if not 1 <= page_num <= len(doc):
            raise ValueError(f"Page {page_num} out of range (document has {len(doc)} pages)")

        page = doc[page_num - 1]
        body_size, text_width = metrics["body_size"], metrics["text_width"]

        # "index" (the position in PyMuPDF's list) is what render_image() takes.
        texts, pictures = [], []
        for i, block in enumerate(page.get_text("dict")["blocks"]):
            block["index"], block["page"] = i, page_num
            if block.get("type") == 1:
                pictures.append(block)
            elif block.get("type") == 0 and "".join(s["text"] for l in block["lines"] for s in l["spans"]).strip():
                texts.append(block)

        # PyMuPDF's own block order follows the file, which isn't always the
        # reading order (headers/footers especially), so it's rebuilt from
        # the layout — column by column where the page has columns.
        ordered, columns, edge = _reading_order(texts, page.rect.height, text_width)

        seen = set()
        content_pictures = []
        for pic in pictures:
            if _is_content_image(pic, page, texts):
                key = tuple(round(v) for v in pic["bbox"])  # a picture and its mask can come twice
                if key not in seen:
                    seen.add(key)
                    content_pictures.append(pic)
        placed = _place_images(content_pictures, ordered, columns, text_width)

        page_area = (0.0, page.rect.width)
        column_area = {id(b): (c["box"][0], c["box"][2]) for c in columns for b in c["blocks"]}
        wrapped = {id(b) for b in texts
                   if any(_beside(line["bbox"], p["bbox"]) for p in content_pictures for line in b["lines"])}

        blocks_out = []
        for pos, block in enumerate(ordered):
            blocks_out.extend(placed.get(pos, []))
            data = _text_block_data(block, page_num, column_area.get(id(block), page_area), body_size,
                                    id(block) in wrapped)
            # Running header/footer (title, page number): the reader skips it when a
            # sentence's context continues onto the previous or next page.
            if id(block) in edge:
                data["edge"] = True
            blocks_out.append(data)
        blocks_out.extend(placed.get(len(ordered), []))

        return {"page": page_num, "total_pages": len(doc), "blocks": blocks_out}


def render_image(path: str, page_num: int, index: int, metrics: dict) -> tuple[bytes, str]:
    # Renders the page area under the picture rather than extracting the
    # embedded file: that copes with masks, CMYK, rotation and odd formats.
    with fitz.open(path) as doc:
        if not 1 <= page_num <= len(doc):
            raise ValueError(f"Page {page_num} out of range (document has {len(doc)} pages)")
        page = doc[page_num - 1]
        blocks = page.get_text("dict")["blocks"]
        if not 0 <= index < len(blocks) or blocks[index].get("type") != 1:
            raise ValueError("Image not found")

        block = blocks[index]
        clip = fitz.Rect(block["bbox"]) & page.rect
        if clip.is_empty:
            raise ValueError("Image not found")
        zoom = min(IMAGE_FULL_WIDTH_PX / metrics["text_width"], IMAGE_MAX_PX / max(clip.width, clip.height))
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False)
        if block.get("ext") in ("jpeg", "jpg", "jpx"):
            return pix.tobytes("jpeg", jpg_quality=85), "image/jpeg"
        return pix.tobytes("png"), "image/png"

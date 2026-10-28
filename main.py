import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

import storage
import llm
import pdf_render
import epub_render
import video
import images
from config import LANGUAGES
from extract import extract_url_blocks

app = FastAPI()


class TranslateRequest(BaseModel):
    phrase: str
    context: str
    source_lang: str
    target_lang: str


class ExplainRequest(BaseModel):
    phrase: str
    context: str
    source_lang: str
    target_lang: str


class UpdateTextRequest(BaseModel):
    title: str
    source_lang: str


class ImportUrlRequest(BaseModel):
    url: str
    source_lang: str
    title: str | None = None


class ImportVideoRequest(BaseModel):
    url: str
    source_lang: str
    title: str | None = None


@app.post("/api/upload")
async def upload(file: UploadFile, title: str = Form(...), source_lang: str = Form(...)):
    suffix = Path(file.filename).suffix.lower()
    raw = await file.read()

    if suffix == ".pdf":
        # Pages are kept as their own layout (see pdf_render.py) and rendered
        # on demand, so only the measurements every page needs are taken here
        # (which also tells whether there's any text at all).
        with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
            tmp.write(raw)
            tmp.flush()
            metrics = pdf_render.analyze(tmp.name)
        if metrics is None:
            raise HTTPException(400, "PDF appears to be a scan with no extractable text (OCR not supported).")
        entry = storage.save_pdf(title, source_lang, raw, metrics)
        return entry
    elif suffix == ".epub":
        # Kept as uploaded and rendered chapter by chapter (see epub_render.py);
        # here only a check that it opens and has text.
        with tempfile.NamedTemporaryFile(suffix=".epub") as tmp:
            tmp.write(raw)
            tmp.flush()
            try:
                epub_render.inspect(tmp.name)
            except epub_render.EpubError as e:
                raise HTTPException(400, str(e))
        entry = storage.save_epub(title, source_lang, raw)
        return entry
    raise HTTPException(400, f"Unsupported file type '{suffix}'. Use .pdf or .epub.")


@app.post("/api/import-url")
def import_url(req: ImportUrlRequest):
    if video.parse_video_id(req.url):
        raise HTTPException(400, "That's a YouTube link; use the Video tab to import it.")
    try:
        blocks, extracted_title = extract_url_blocks(req.url)
    except ValueError as e:
        raise HTTPException(400, str(e))

    title = req.title or extracted_title or req.url
    if extracted_title:
        heading = {"kind": "heading", "level": 1, "runs": [{"text": extracted_title, "italic": False, "bold": False}]}
        blocks = [heading] + blocks
    # Pictures are downloaded (with limits, see images.py) and kept next to the text.
    # A picture that can't be fetched is left out; it never fails the import.
    blocks, image_files = images.localize(blocks, referer=req.url)
    entry = storage.save_article(title, req.source_lang, blocks)
    try:
        images.save_images(entry["id"], image_files)
    except OSError:
        # e.g. disk full: the article is saved, so keep it; the reader hides pictures whose file is missing
        images.delete_images(entry["id"])
    return entry


@app.post("/api/import-video")
def import_video(req: ImportVideoRequest):
    # Sync `def` on purpose: yt-dlp blocks for seconds, and FastAPI runs plain
    # `def` endpoints in a worker thread instead of on the event loop.
    if req.source_lang not in LANGUAGES:
        raise HTTPException(400, f"Unsupported language '{req.source_lang}'.")
    video_id = video.parse_video_id(req.url)
    if video_id is None:
        raise HTTPException(400, "That doesn't look like a YouTube video link.")
    try:
        result = video.fetch_subtitles(video_id, req.source_lang)
    except video.VideoError as e:
        raise HTTPException(e.status_code, str(e))

    title = (req.title or "").strip() or result["title"]
    return storage.save_video(title, req.source_lang, video_id, result["segments"], result["subtitle_source"])


@app.get("/api/languages")
def languages():
    return [{"code": code, **lang} for code, lang in LANGUAGES.items()]


@app.get("/api/texts")
def list_texts():
    return storage.list_texts()


@app.get("/api/texts/{text_id}")
def get_text(text_id: str):
    entry = storage.get_text(text_id)
    if entry is None:
        raise HTTPException(404, "Text not found")
    if entry["kind"] == "pdf":
        # The reader maps an original page to the reading-mode part that holds it.
        entry = {**entry, "pages_per_part": pdf_render.PAGES_PER_PART}
    return entry


def _pdf(text_id: str) -> tuple[str, dict]:
    # The stored PDF and its measurements (see pdf_render.analyze).
    found = storage.get_original(text_id, "pdf")
    if found is None:
        raise HTTPException(404, "PDF not found")
    path, entry = found
    metrics = entry.get("metrics")
    if metrics is None:  # uploaded before they were taken at upload: once, then kept
        metrics = pdf_render.analyze(str(path))
        if metrics is None:
            raise HTTPException(404, "PDF has no text")
        storage.update_entry(text_id, metrics=metrics)
    return str(path), metrics


def _epub_path(text_id: str) -> str:
    found = storage.get_original(text_id, "epub")
    if found is None:
        raise HTTPException(404, "EPUB not found")
    return str(found[0])


@app.get("/api/texts/{text_id}/pdf-page/{page_num}")
def get_pdf_page(text_id: str, page_num: int):
    path, metrics = _pdf(text_id)
    try:
        return pdf_render.render_page(path, page_num, metrics)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.get("/api/texts/{text_id}/pdf-part/{part}")
def get_pdf_part(text_id: str, part: int):
    path, metrics = _pdf(text_id)
    try:
        return pdf_render.render_reading_part(path, part, metrics)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.get("/api/texts/{text_id}/pdf-page/{page_num}/images/{index}")
def get_pdf_image(text_id: str, page_num: int, index: int):
    path, metrics = _pdf(text_id)
    try:
        data, media_type = pdf_render.render_image(path, page_num, index, metrics)
    except ValueError as e:
        raise HTTPException(404, str(e))
    # The PDF never changes, but how it's rendered might: a day, not forever.
    return Response(data, media_type=media_type, headers={"Cache-Control": "public, max-age=86400",
                                                          "X-Content-Type-Options": "nosniff"})


@app.get("/api/texts/{text_id}/epub-chapter/{chapter}")
def get_epub_chapter(text_id: str, chapter: int):
    try:
        return epub_render.render_chapter(_epub_path(text_id), chapter)
    except epub_render.EpubError as e:
        raise HTTPException(404, str(e))


@app.get("/api/texts/{text_id}/epub-image/{member:path}")
def get_epub_image(text_id: str, member: str):
    try:
        data, media_type = epub_render.read_image(_epub_path(text_id), member)
    except epub_render.EpubError as e:
        raise HTTPException(404, str(e))
    return Response(data, media_type=media_type, headers={"Cache-Control": "public, max-age=86400",
                                                          "X-Content-Type-Options": "nosniff"})


@app.get("/api/texts/{text_id}/images/{name}")
def get_text_image(text_id: str, name: str):
    path = images.image_path(text_id, name)
    if path is None:
        raise HTTPException(404, "Image not found")
    # The name is a hash of the source address, so a file never changes: cache it for good.
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable",
                                       "X-Content-Type-Options": "nosniff"})


@app.patch("/api/texts/{text_id}")
def update_text(text_id: str, req: UpdateTextRequest):
    entry = storage.update_text(text_id, req.title, req.source_lang)
    if entry is None:
        raise HTTPException(404, "Text not found")
    return entry


@app.delete("/api/texts/{text_id}")
def delete_text(text_id: str):
    if not storage.delete_text(text_id):
        raise HTTPException(404, "Text not found")
    images.delete_images(text_id)
    return {"ok": True}


@app.post("/api/translate")
def translate(req: TranslateRequest):
    try:
        translation = llm.translate(req.phrase, req.context, req.source_lang, req.target_lang)
    except llm.LLMError as e:
        raise HTTPException(e.status_code, str(e))
    return {"translation": translation}


@app.post("/api/explain")
def explain(req: ExplainRequest):
    try:
        result = llm.explain(req.phrase, req.context, req.source_lang, req.target_lang)
    except llm.LLMError as e:
        raise HTTPException(e.status_code, str(e))
    return result


class RevalidatingStaticFiles(StaticFiles):

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


BASE_DIR = Path(__file__).parent
app.mount("/static", RevalidatingStaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html", headers={"Cache-Control": "no-cache"})
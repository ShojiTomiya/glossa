# Glossa

A personal reading app for learning languages. Upload a PDF or EPUB, import an article straight from a URL, or paste a YouTube link - read (or watch) it in the browser, and select any word or phrase to get an instant translation and a grammar breakdown.

## Features

- Upload a PDF and read it page by page, laid out like the original - headers, footers, footnotes, page numbers all shown in place, styled by their actual size/weight/position instead of being flattened into one text stream. Multi-column pages are read column by column, and pictures are shown where they stand on the page, with the text wrapping around them as in the original
- Upload an EPUB and read it page by page like in an e-reader: the book is laid out in pages that fit the window and your font size, the arrows (or ←/→) turn pages and go on into the next chapter, and the topbar shows how far into the book you are. Headings, italic/bold (also when the book sets them through its CSS), lists, quotes, pictures with their captions and footnotes are kept; the book's own contents page is left out. A picture that doesn't fit on what's left of a page moves to the next one, as in other readers
- Import an article directly from a URL - the page's main content is extracted automatically (ads/nav/comments stripped out), with headings, bold/italic, tables, lists and pictures (captions included) kept as real structure instead of flattened text
- Paste a YouTube link to learn from video: the player is embedded (nothing is downloaded) and the subtitles run in a window beneath it, synced to playback - the current line stays in the middle, a click on a timestamp jumps there. Select any part of the subtitles to translate or explain it (the video pauses); the neighbouring subtitle lines serve as context. Uploader-made subtitles are preferred, auto-generated ones are used otherwise and marked as such
- Select any word or phrase for a quick translation popup
- **Explain** panel: per-word breakdown (base form, translation, IPA pronunciation, part of speech, grammatical details) plus a plain-language explanation of why the phrase uses that exact grammatical form. IPA is generated locally with eSpeak NG, not by the LLM
- Reading position is remembered automatically - the current page for PDFs, the place in the book for EPUBs (it survives font and window size changes), the line at the top of the screen for articles, the playback position for videos
- Adjustable reading font/size and light/dark/default themes - applies everywhere, including PDFs
- Supported languages: German, Spanish, Italian, French, English, Polish (to add another, extend `LANGUAGES` and `ESPEAK_VOICES` in config.py; run `espeak-ng --voices` to see available voice codes). For videos the language is the one spoken in the video, i.e. the subtitle language

## Stack

- **Backend:** FastAPI + Python - PDFs are rendered per-page via PyMuPDF's structured text extraction (`pdf_render.py`), not flattened to plain text; EPUBs are rendered per-chapter from the original file (`epub_render.py`, BeautifulSoup), trafilatura for URL article extraction; [yt-dlp](https://github.com/yt-dlp/yt-dlp) for YouTube subtitles (`video.py`)
- **Frontend:** vanilla HTML/CSS/JS, no build step; videos play in YouTube's own embedded player (IFrame Player API)
- **LLM:** any OpenAI-compatible API - configured for [Groq](https://groq.com) by default, with a local [Ollama](https://ollama.com) option
- **Phonetics:** [eSpeak NG](https://github.com/espeak-ng/espeak-ng) via [phonemizer](https://github.com/bootphon/phonemizer)
- **Storage:** flat files on disk (`texts/` + a JSON index), no database - PDFs and EPUBs are kept as the original file; URL imports are stored as structured blocks (heading/paragraph/list-item/table-row/image + styled text runs) in JSON, and the pictures of a URL import are kept as files next to it (`texts/<id>.images/`); video imports store only the subtitle cues (start, end, text) and the video id - the video itself is never downloaded

## Setup

1. Install dependencies (includes a bundled eSpeak NG for IPA transcriptions):

```
   pip install -r requirements.txt
```

2. Create a `.env` file in the project root:

```
   GROQ_API_KEY=your_key_here
   LLM_PROVIDER=groq
```

3. Video mode only: yt-dlp needs an external JavaScript runtime to read YouTube. Install [Deno](https://deno.com) (macOS/Linux: `curl -fsSL https://deno.land/install.sh | sh`, Windows: `winget install DenoLand.Deno`), or Node.js 22+ and add `YTDLP_JS_RUNTIME=node` to `.env`. If the server can't find Deno on its `PATH`, give the full path instead: `YTDLP_JS_RUNTIME=deno:/full/path/to/deno`. See yt-dlp's [EJS wiki](https://github.com/yt-dlp/yt-dlp/wiki/EJS) for the currently supported runtimes and versions. Everything except video import works without it.

4. Run the server:

```
   uvicorn main:app --reload
```

5. Open <http://127.0.0.1:8000>

## Using a local model instead of Groq

Set `LLM_PROVIDER=ollama` in `.env` and have [Ollama](https://ollama.com) running locally with the model pulled:

```
ollama pull qwen3:8b
```

Model choice and API settings for both providers live in `config.py`.

## Video mode

1. In the library click **Upload**, switch to the **Video** tab, paste a YouTube link and pick the language that is *spoken* in the video. Importing takes a few seconds: Glossa asks yt-dlp for the subtitles in that language and stores only those.
2. Open the video from the library. Scroll the subtitle window to look around (**Follow playback** brings you back to the current line) and click a timestamp to jump there.
3. Select a word, a phrase or several lines: the video pauses and the translation popup appears; **Explain** works as in the text reader. The selected lines plus 4 on each side are sent to the model as context.

Which subtitles are used: uploader-made ones in the chosen language if the video has them (regional variants such as `de-DE` count), otherwise YouTube's auto-generated track in the video's original language. YouTube's machine *translations* of subtitles are never used. Auto-generated subtitles are marked "auto subs" in the library and can contain recognition errors.

Import problems are reported in the dialog: no subtitles in that language (the message lists what the video has), embedding disabled by the owner, private/removed/region-locked video, live streams and premieres, YouTube asking for a sign-in or rate-limiting the server.

YouTube changes often, so if imports suddenly start failing, update yt-dlp first:

```
pip install -U "yt-dlp[default]"
```

## Notes

- PDFs and EPUBs are stored as-is and rendered on request, so no re-upload is needed to pick up reader improvements. URL imports are still converted at import time; re-import those if the extraction logic changes. EPUBs uploaded before the paged reader existed were stored as extracted text and still open in the old continuous reader - upload them again to get pages, pictures and the rest.
- PDF layout is reconstructed from the positions of text blocks and pictures, which is a heuristic: typical one-, two- or three-column pages work, but unusual layouts (sidebars, text boxes, complex tables) can come out in the wrong order, and a picture can end up next to a different paragraph than in the original. Tiny pictures (ornaments, icons) and page-sized ones with text on top (backgrounds, scans) are skipped on purpose.
- Vector graphics (charts and diagrams drawn with lines, drawn tables, decorative rules) aren't shown - only embedded pictures are. Mathematical formulas aren't handled either: they come out as loose, reordered symbols, so PDFs with a lot of math (textbooks, papers) don't read well.
- The context sent with a selection is the sentence around it. When that sentence starts on the previous page or runs on to the next one (or across a picture or a footnote), the missing part is taken from there - one paragraph each way at most; running headers, page numbers and footnotes in between are skipped. In EPUBs this works within a chapter.
- Pictures of a URL import are downloaded when you import: up to 25 per article, JPEG/PNG/GIF/WebP only (no SVG), at most 6 MB each; icons, tracking pixels and anything that doesn't look like a real image are skipped, and a picture that can't be fetched is simply left out. Only public addresses are fetched, so a page can't make your machine call things on your local network. Articles imported before this feature have no pictures - re-import them.
- URL import works well for typical articles, but may fail on JS-heavy pages or paywalled content, since it fetches the raw page rather than rendering it. Section headings are dropped on some sites (Wikipedia notably) - that's the extraction library not finding them, not something fixable on our end.
- The Groq free tier caps out at 1000 requests/day; hitting the limit surfaces as a message in the UI instead of an error. Results aren't cached, and a video invites many more selections than a book does, so the limit is reached sooner.
- Videos need an internet connection (the player streams from YouTube) and a subtitle track in the chosen language; transcribing videos that have none (e.g. with Whisper) isn't supported. The video itself is never saved, so a video that is later removed or restricted on YouTube stops playing, while its subtitles stay readable.
- Static files are served with `Cache-Control: no-cache`, so after changing the frontend a normal browser reload is enough.
- IPA transcriptions come from eSpeak NG's rule-based phonemizer, so they're consistent but approximate (e.g. stress and vowel quality can differ from dictionary IPA). A language missing from `ESPEAK_VOICES` simply shows no transcription.
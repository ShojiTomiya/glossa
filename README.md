# Glossa

A personal reading app for learning languages. Upload a PDF, EPUB, or plain text file - or import an article straight from a UR - read it in the browser, and select any word or phrase to get an instant translation and a grammar breakdown.

## Features

- Upload a PDF and read it page by page, laid out like the original - headers, footers, footnotes, page numbers all shown in place, styled by their actual size/weight/position instead of being flattened into one text stream
- Upload EPUB and read it in a continuous reader with real headings and inline italic/bold kept intact (not flattened into plain text); `.txt` files read the same way, minus the structure they don't have to begin with
- Import an article directly from a URL - the page's main content is extracted automatically (ads/nav/comments stripped out), with headings, bold/italic, tables and lists kept as real structure instead of flattened text
- Select any word or phrase for a quick translation popup
- **Explain** panel: per-word breakdown (base form, translation, IPA pronunciation, part of speech, grammatical details) plus a plain-language explanation of why the phrase uses that exact grammatical form. IPA is generated locally with eSpeak NG, not by the LLM
- Reading position is remembered automatically - current page for PDFs, a clickable line bookmark (with a floating jump-back button) for EPUB/TXT/URL reads
- Adjustable reading font/size and light/dark/default themes - applies everywhere, including PDFs
- Supported languages: German, Spanish, Italian, French, English, Polish (to add another, extend `LANGUAGES` and `ESPEAK_VOICES` in config.py; run `espeak-ng --voices` to see available voice codes)

## Stack

- **Backend:** FastAPI + Python - PDFs are rendered per-page via PyMuPDF's structured text extraction (`pdf_render.py`), not flattened to plain text; ebooklib/BeautifulSoup for EPUB, trafilatura for URL article extraction
- **Frontend:** vanilla HTML/CSS/JS, no build step
- **LLM:** any OpenAI-compatible API - configured for [Groq](https://groq.com) by default, with a local [Ollama](https://ollama.com) option
- **Phonetics:** [eSpeak NG](https://github.com/espeak-ng/espeak-ng) via [phonemizer](https://github.com/bootphon/phonemizer)
- **Storage:** flat files on disk (`texts/` + a JSON index), no database - PDFs are kept as the original file; EPUB and URL imports are stored as structured blocks (heading/paragraph/list-item/table-row + styled text runs) in JSON; plain `.txt` uploads are stored as-is

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

3. Run the server:

```
   uvicorn main:app --reload
```

4. Open <http://127.0.0.1:8000>

## Using a local model instead of Groq

Set `LLM_PROVIDER=ollama` in `.env` and have [Ollama](https://ollama.com) running locally with the model pulled:

```
ollama pull qwen3:8b
```

Model choice and API settings for both providers live in `config.py`.

## Notes

- PDFs are stored as-is and rendered on request, so no re-upload is needed to pick up reader improvements. EPUB/TXT/URL imports are still converted at upload time; re-import those if the extraction logic changes.
- PDF rendering only reproduces text (with its real size/weight/color/position) - embedded images and vector graphics (drawn tables, decorative lines) aren't shown. Fine for prose, not for heavily illustrated PDFs.
- Selecting text near the very end of a PDF page won't pull in context from the next page even if the sentence continues there - context stays within the block/page it started in.
- URL import works well for typical articles, but may fail on JS-heavy pages or paywalled content, since it fetches the raw page rather than rendering it. Section headings are dropped on some sites (Wikipedia notably) - that's the extraction library not finding them, not something fixable on our end.
- The Groq free tier caps out at 1000 requests/day; hitting the limit surfaces as a message in the UI instead of an error.
- IPA transcriptions come from eSpeak NG's rule-based phonemizer, so they're consistent but approximate (e.g. stress and vowel quality can differ from dictionary IPA). A language missing from `ESPEAK_VOICES` simply shows no transcription.
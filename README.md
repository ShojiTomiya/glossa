# Glossa

A personal reading app for learning languages. Upload a PDF, EPUB, or plain text file - or import an article straight from a URL - read it in the browser, and select any word or phrase to get an instant translation and a grammar breakdown.

## Features

- Upload PDF, EPUB, or `.txt` files and read them in a distraction-free reader
- Import an article directly from a URL - the page's main content is extracted automatically, ads/nav/comments stripped out
- Select any word or phrase for a quick translation popup
- **Explain** panel: per-word breakdown (base form, translation, IPA pronunciation, part of speech, grammatical details) plus a plain-language explanation of why the phrase uses that exact grammatical form
- Bookmark your reading position - click a line to mark it, a floating button jumps back to it (and hides once it's back in view)
- Adjustable reading font/size and light/dark/default themes
- Supported languages: German, Spanish, Italian, French, English, Polish (another language can be easily added in config.py)

## Stack

- **Backend:** FastAPI + Python — PyMuPDF for PDF extraction, ebooklib/BeautifulSoup for EPUB, trafilatura for URL article extraction
- **Frontend:** vanilla HTML/CSS/JS, no build step
- **LLM:** any OpenAI-compatible API — configured for [Groq](https://groq.com) by default, with a local [Ollama](https://ollama.com) option
- **Storage:** flat files on disk (`texts/` + a JSON index), no database

## Setup

1. Install dependencies:
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
4. Open http://127.0.0.1:8000

## Using a local model instead of Groq

Set `LLM_PROVIDER=ollama` in `.env` and have [Ollama](https://ollama.com) running locally with the model pulled:

```
ollama pull qwen3:8b
```

Model choice and API settings for both providers live in `config.py`.

## Notes

- Uploaded texts are extracted to plain text on upload and stored under `texts/` — the original PDF/EPUB isn't kept, so re-upload a file after any display changes.
- URL import works well for typical articles, but may fail on JS-heavy pages or paywalled content, since it fetches the raw page rather than rendering it.
- The Groq free tier caps out at 1000 requests/day; hitting the limit surfaces as a message in the UI instead of an error.
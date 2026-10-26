import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

PROVIDER = os.getenv("LLM_PROVIDER", "groq")

CONFIGS = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "api_key": os.getenv("GROQ_API_KEY"),
        "model": "openai/gpt-oss-120b",
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "api_key": "ollama",
        "model": "qwen3:8b",
    },
}

CONFIG = CONFIGS[PROVIDER]

# The only list of languages: the frontend gets it from /api/languages.
#   name    — shown in the UI and used in the prompts (lang_notes.py is keyed by it)
#   espeak  — eSpeak NG voice for the IPA (`espeak-ng --voices` lists them);
#             None leaves the transcription out
#   speech  — language tag for the browser's speech synthesis (listen button);
#             same region as the eSpeak voice, so sound and IPA agree
LANGUAGES = {
    "de": {"name": "German", "espeak": "de", "speech": "de-DE"},
    "es": {"name": "Spanish", "espeak": "es", "speech": "es-ES"},
    "it": {"name": "Italian", "espeak": "it", "speech": "it-IT"},
    "fr": {"name": "French", "espeak": "fr-fr", "speech": "fr-FR"},
    "en": {"name": "English", "espeak": "en-us", "speech": "en-US"},
    "pl": {"name": "Polish", "espeak": "pl", "speech": "pl-PL"},
}

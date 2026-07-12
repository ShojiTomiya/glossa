import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

PROVIDER = os.getenv("LLM_PROVIDER", "groq")

CONFIGS = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "api_key": os.getenv("GROQ_API_KEY"),
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "api_key": "ollama",
        "model": "qwen3:8b",
    },
}

CONFIG = CONFIGS[PROVIDER]

LANGUAGES = {
    "de": "German",
    "es": "Spanish",
    "it": "Italian",
    "fr": "French",
    "en": "English",
    "pl": "Polish",
}

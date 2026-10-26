import json
import re

from openai import OpenAI, APIError, BadRequestError, RateLimitError

from config import CONFIG, LANGUAGES
from prompts import translate_messages, explain_messages, FIX_JSON_PROMPT
import phonetics

# The readers shape the context themselves (a few sentences or subtitle
# lines, at most 1500 characters: MAX_CONTEXT_CHARS in static/js/context.js);
# this only caps what a single request can send.
MAX_CONTEXT_CHARS = 2000


class LLMError(Exception):
    # A failure worth showing the user as is; status_code is the HTTP status main.py answers with.
    status_code = 502


class RateLimitExceeded(LLMError):
    status_code = 429


class NotConfigured(LLMError):
    status_code = 503


_client: OpenAI | None = None


def _get_client() -> OpenAI:
    # Created on first use, so the rest of the app (reading, importing) works
    # without an API key; only translating says that one is missing.
    global _client
    if _client is None:
        if not CONFIG["api_key"]:
            raise NotConfigured("No API key found: set GROQ_API_KEY in .env (see README) and restart the server.")
        _client = OpenAI(base_url=CONFIG["base_url"], api_key=CONFIG["api_key"])
    return _client


def _lang_name(code: str) -> str:
    return LANGUAGES.get(code, {}).get("name", code)


def _wait_text(spec: str) -> str:
    # Groq's "7.66s", "2m59.5s", "1h2m" -> "8 s", "3 min", "62 min".
    parts = dict((unit, float(n)) for n, unit in re.findall(r"([\d.]+)([hms])", spec))
    seconds = parts.get("h", 0) * 3600 + parts.get("m", 0) * 60 + parts.get("s", 0)
    return f"{max(1, round(seconds))} s" if seconds < 60 else f"{round(seconds / 60)} min"


def _rate_limit_message(error: RateLimitError) -> str:
    # Groq says which limit was hit ("... on tokens per minute (TPM) ...",
    # "... on requests per day (RPD) ...") and when to try again. A per-minute
    # limit is easy to hit with a few quick Explains and passes in seconds,
    # so it mustn't read like the daily one. Other providers get the generic text.
    text = str(error)
    wait = re.search(r"try again in ((?:[\d.]+[hms])+)", text)
    after = f" Try again in {_wait_text(wait.group(1))}." if wait else ""
    if "per day" in text:
        return f"Daily API limit reached.{after or ' Try again tomorrow.'}"
    if "per minute" in text:
        return f"Too many requests in a short time.{after or ' Try again in a moment.'}"
    return f"API rate limit reached.{after or ' Try again later.'}"


def _complete(**kwargs) -> str:
    try:
        response = _get_client().chat.completions.create(model=CONFIG["model"], **kwargs)
    except RateLimitError as e:
        raise RateLimitExceeded(_rate_limit_message(e)) from e
    except BadRequestError as e:
        # Groq rejects a reply that isn't valid JSON (json_object mode) but
        # hands it back: explain() can still repair it.
        body = getattr(e.response, "json", lambda: {})()
        failed = body.get("error", {}).get("failed_generation", "") if isinstance(body, dict) else ""
        if failed:
            return failed
        raise LLMError(f"The LLM API rejected the request: {e}") from e
    except APIError as e:  # connection problems, bad key, server errors
        raise LLMError(f"LLM request failed: {e}") from e
    return response.choices[0].message.content or ""


def _parse_json(text: str) -> tuple[dict | None, str | None]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text), None
    except json.JSONDecodeError:
        repaired = text.replace("“", '"').replace("”", '"').replace("’", "'")
        repaired = re.sub(r",\s*([}\]])", r"\1", repaired)
        try:
            return json.loads(repaired), None
        except json.JSONDecodeError as e:
            return None, str(e)


def translate(phrase: str, context: str, source_lang: str, target_lang: str) -> str:
    messages = translate_messages(phrase, context[:MAX_CONTEXT_CHARS], _lang_name(source_lang), _lang_name(target_lang))
    content = _complete(messages=messages, temperature=0.2, max_tokens=300, extra_body={"reasoning_effort": "low"})
    return content.strip()


def _call_explain(messages: list) -> str:
    return _complete(
        messages=messages,
        temperature=0.3,
        max_tokens=1500,
        response_format={"type": "json_object"},
        extra_body={"reasoning_effort": "low"},
    )


def explain(phrase: str, context: str, source_lang: str, target_lang: str) -> dict:
    messages = explain_messages(phrase, context[:MAX_CONTEXT_CHARS], _lang_name(source_lang), _lang_name(target_lang))

    content = _call_explain(messages)
    parsed, error = _parse_json(content)

    if parsed is None:
        # one retry: ask the model to fix its own malformed JSON
        fix_messages = messages + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": FIX_JSON_PROMPT.format(error=error, raw=content[:1000])},
        ]
        content = _call_explain(fix_messages)
        parsed, error = _parse_json(content)
        if parsed is None:
            raise LLMError(f"Model returned invalid JSON twice ({error}). Raw response: {content[:500]!r}")

    if isinstance(parsed, dict):
        phonetics.add_phonetics(parsed.get("words"), source_lang)
    return parsed

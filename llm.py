import json
import re

from openai import OpenAI, BadRequestError, RateLimitError

from config import CONFIG, LANGUAGES
from prompts import translate_messages, explain_messages, FIX_JSON_PROMPT

client = OpenAI(base_url=CONFIG["base_url"], api_key=CONFIG["api_key"])

RATE_LIMIT_MESSAGE = "Dzienny limit zapytań do API został wyczerpany. Spróbuj ponownie później."


class RateLimitExceeded(Exception):
    pass


def _lang_name(code: str) -> str:
    return LANGUAGES.get(code, code)


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


def translate(phrase: str, source_lang: str, target_lang: str) -> str:
    messages = translate_messages(phrase, _lang_name(source_lang), _lang_name(target_lang))
    try:
        response = client.chat.completions.create(
            model=CONFIG["model"],
            messages=messages,
            temperature=0.2,
            max_tokens=300,
            extra_body={"reasoning_effort": "low"},
        )
    except RateLimitError:
        raise RateLimitExceeded(RATE_LIMIT_MESSAGE)
    return response.choices[0].message.content.strip()


MAX_CONTEXT_CHARS = 800


def _call_explain(messages: list) -> str:
    try:
        response = client.chat.completions.create(
            model=CONFIG["model"],
            messages=messages,
            temperature=0.3,
            max_tokens=1500,
            response_format={"type": "json_object"},
            extra_body={"reasoning_effort": "low"},
        )
        return response.choices[0].message.content
    except RateLimitError:
        raise RateLimitExceeded(RATE_LIMIT_MESSAGE)
    except BadRequestError as e:
        body = getattr(e.response, "json", lambda: {})()
        failed = body.get("error", {}).get("failed_generation", "")
        if not failed:
            raise
        return failed


def explain(phrase: str, context: str, source_lang: str, target_lang: str) -> dict:
    context = context[:MAX_CONTEXT_CHARS]
    messages = explain_messages(phrase, context, _lang_name(source_lang), _lang_name(target_lang))

    content = _call_explain(messages)
    parsed, error = _parse_json(content)
    if parsed is not None:
        return parsed

    # one retry: ask the model to fix its own malformed JSON
    fix_messages = messages + [
        {"role": "assistant", "content": content},
        {"role": "user", "content": FIX_JSON_PROMPT.format(error=error, raw=content[:1000])},
    ]
    content = _call_explain(fix_messages)
    parsed, error = _parse_json(content)
    if parsed is not None:
        return parsed

    raise ValueError(f"Model returned invalid JSON twice ({error}). Raw response: {content[:500]!r}")

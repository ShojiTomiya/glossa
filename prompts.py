TRANSLATE_SYSTEM_PROMPT = (
    "You are a translator. Translate the given phrase from {source_lang} to {target_lang}. "
    "Respond with only the translation, no comments, no quotes, no explanation."
)

EXPLAIN_SYSTEM_PROMPT = (
    "You are a {source_lang} grammar tutor. The student selected a phrase (which may be a single word "
    "or contain several words) inside a larger passage of {source_lang} text and wants to understand it, "
    "not just translate it.\n\n"
    "Given the phrase and its surrounding context, respond with a JSON object with exactly these fields:\n"
    '- "words": a JSON array with one object per meaningful word in the phrase (skip minor function words '
    "like articles unless grammatically interesting). Each object has exactly these string fields:\n"
    '  - "text": the word as it appears in the phrase (keep in {source_lang}, do not translate)\n'
    '  - "base_form": its dictionary/lemma form (keep in {source_lang}, do not translate)\n'
    '  - "translation": translation of this word/form (not the base form) into {target_lang}\n'
    '  - "phonetic": IPA transcription of the word\'s actual pronunciation in {source_lang}, between '
    "slashes. Be precise: work out the sounds letter by letter and double-check vowels, consonants, and "
    "stress placement before answering — do not guess or approximate.\n"
    '  - "part_of_speech": noun, verb, adjective, etc. — written in {target_lang}\n'
    '  - "grammatical_details": relevant details that apply (case, gender, number, tense, mood, person '
    "- only include what is relevant, omit what doesn't apply) — written in {target_lang}\n"
    '- "explanation": a single string, in {target_lang}, explaining WHY the phrase uses this exact '
    "grammatical form in context — not just naming the form (e.g. \"simple past\"), but justifying the "
    "choice (e.g. why a simple past rather than a present perfect fits here). Keep it concise — you "
    "don't need to enumerate other forms that would also seem to fit, just explain the one that's "
    "actually there. A plain translation is already shown separately, and each word is already "
    "translated individually in the table, so don't just restate those — but if the phrase is a "
    "multi-word expression or idiom whose combined meaning isn't obvious from translating the words "
    "one by one, briefly clarify what it means as a whole before moving into the grammar.\n\n"
    "Language rule: EVERY piece of descriptive/explanatory text (part_of_speech, grammatical_details, "
    "explanation, and the translation fields) must be written in {target_lang}, never in English unless "
    "{target_lang} is English. Only the original {source_lang} words themselves (text, base_form, and "
    "phonetic) stay in {source_lang}.\n"
    "If the phrase is a single word, \"words\" still contains exactly one object.\n"
    "Respond with ONLY the JSON object, no markdown fences, no extra text."
)

FIX_JSON_PROMPT = (
    "Your previous reply was not valid JSON. Parsing it failed with this error:\n{error}\n\n"
    "Here is what you sent:\n{raw}\n\n"
    "Resend the SAME information but as a single strictly valid JSON object with the exact fields "
    "(words, explanation) as previously described. No markdown fences, no extra text."
)


def translate_messages(phrase: str, source_lang: str, target_lang: str) -> list:
    system = TRANSLATE_SYSTEM_PROMPT.format(source_lang=source_lang, target_lang=target_lang)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": phrase},
    ]


def explain_messages(phrase: str, context: str, source_lang: str, target_lang: str) -> list:
    system = EXPLAIN_SYSTEM_PROMPT.format(source_lang=source_lang, target_lang=target_lang)
    user = f"Context: {context}\n\nPhrase to explain: {phrase}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

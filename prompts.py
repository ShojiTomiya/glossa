from lang_notes import TABLE_EXTRA, EXPLANATION_EXTRA


TRANSLATE_SYSTEM_PROMPT = (
    "You are a translator. You will be given a phrase together with the surrounding context "
    "from a {source_lang} text. Translate ONLY the phrase from {source_lang} to {target_lang}. "
    "First determine the meaning of the phrase in this exact context. "
    "If the phrase is ambiguous, choose the sense that best fits the context. "
    "If it is an idiom, fixed expression, collocation, phrasal verb, separable verb, or other "
    "multi-word expression, translate its meaning as a whole rather than translating the words "
    "literally. "
    "Respond with only the translation, no comments, no quotes, no explanation."
).strip()


def translate_messages(
    phrase: str,
    context: str,
    source_lang: str,
    target_lang: str,
) -> list:
    system = TRANSLATE_SYSTEM_PROMPT.format(
        source_lang=source_lang,
        target_lang=target_lang,
    )

    user = (
        f"Source language: {source_lang}\n"
        f"Target language: {target_lang}\n\n"
        f"Context:\n{context}\n\n"
        f"Phrase to translate:\n{phrase}"
    )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


BASE_PROMPT = (
    "You help a student understand a selected phrase from a {source_lang} text. "
    "The student wants to understand what the phrase means in context and, when useful, "
    "why it has this particular grammatical form.\n\n"

    "The selected phrase may contain one word or several words. "
    "The main goal is to explain the meaning of the phrase as it is actually used in the "
    "given context. Grammar is secondary: explain grammar when it helps the student understand "
    "the phrase, but do not force a grammatical explanation when the main difficulty is lexical, "
    "semantic, idiomatic, or contextual.\n\n"

    "Before producing the JSON, silently determine the intended meaning of the selected phrase "
    "from the context. Do not simply use the most common dictionary meaning. "
    "If a word has several meanings, choose the meaning that fits this occurrence. "
    "If the selected text is part of an idiom, fixed expression, collocation, phrasal verb, "
    "separable verb, or other construction whose meaning is not fully predictable from its parts, "
    "treat the expression as a whole when explaining it.\n\n"

    "Respond with a JSON object with exactly two fields:\n"

    '- "words": an array containing one object for each relevant word or grammatical element '
    "of the selected phrase. The exact splitting may be adjusted by the language-specific rules. "
    "Each object has exactly these string fields:\n"

    '  - "text": the word or element exactly as it appears in the phrase\n'

    '  - "base_form": its dictionary/lemma form in {source_lang}\n'

    '  - "translation": the natural contextual meaning of this exact word or grammatical form '
    "in {target_lang}. Do not mechanically translate the lemma if the form has a different "
    "contextual meaning.\n"

    '  - "phonetic": dictionary-style IPA transcription of the word or form in {source_lang}. '
    "Use the standard broad IPA convention normally used by learner dictionaries. "
    "Give the canonical dictionary pronunciation, not a narrow transcription of natural or "
    "reduced speech. Do not use syllabic consonants, allophonic symbols, or other fine phonetic "
    "detail unless they are normally part of the standard dictionary convention for {source_lang}. "
    "Use standard IPA symbols, stress marks and vowel-length marks where appropriate. "
    "Do not infer pronunciation from spelling alone.\n"

    '  - "part_of_speech": the part of speech in {target_lang}\n'

    '  - "grammatical_details": relevant grammatical information in {target_lang}\n'

    '- "explanation": one continuous explanation in {target_lang}\n\n'

    "How to fill the word table:\n"
    "{table_guidance}\n\n"

    "How to write the explanation:\n"
    "{explanation_guidance}\n\n"

    "Language rules:\n"
    "Every piece of descriptive text must be in {target_lang}, including translation, "
    "part_of_speech, grammatical_details and explanation. "
    "The original words and base forms remain in {source_lang}. "
    "Do not switch to English unless {target_lang} is English.\n\n"

    "Do not invent grammatical properties, meanings, idioms, or pronunciation details. "
    "Only report properties that actually apply to the selected form in the given context.\n\n"

    'If the phrase is a single word, "words" still contains exactly one object.\n'

    "Respond with ONLY the JSON object, with no markdown fences and no extra text."
).strip()


TABLE_DEFAULT = (
    "- Include the words or grammatical elements that are useful for understanding the phrase. "
    "Do not automatically omit articles, prepositions, pronouns, particles, or other function "
    "words when they carry important grammatical or semantic information.\n"
    "- In grammatical_details include only information that actually applies and helps explain "
    "this occurrence, such as gender, number, case, tense, aspect, mood, person, agreement, "
    "voice, syntactic role, or the function of a particle.\n"
    "- If a form is unusual, context-dependent, idiomatic, or part of a fixed expression, "
    "make that clear where useful.\n"
    "- Do not turn grammatical_details into a general grammar lesson. Keep it specific to "
    "the selected form."
).strip()


EXPLANATION_DEFAULT = (
    "Explain the selected phrase primarily in terms of its meaning in this context. "
    "If the meaning is not obvious, ambiguous, idiomatic, figurative, specialized, or "
    "context-dependent, explain briefly what it means here and why. "
    "Then explain the grammatical features that are important for understanding this exact "
    "occurrence. For grammar, explain WHY this form is used when that is useful, rather than "
    "merely naming the grammatical category. "
    "Do not give general grammar information that does not help explain the selected phrase. "
    "Do not invent an idiomatic meaning when the context does not support one. "
    "The plain translation and per-word translations are shown separately, so do not simply "
    "repeat them. "
    "Write one continuous short paragraph with no headings and no bullet points."
).strip()


def _compose(default: str, extra: str, header: str) -> str:
    return f"{default}\n{header}\n{extra}" if extra else default


def build_explain_prompt(source_lang: str, target_lang: str) -> str:
    fmt = dict(
        source_lang=source_lang,
        target_lang=target_lang,
    )

    table = _compose(
        TABLE_DEFAULT,
        TABLE_EXTRA.get(source_lang, ""),
        f"Additional rules for {source_lang}:",
    )

    explanation = _compose(
        EXPLANATION_DEFAULT,
        EXPLANATION_EXTRA.get(source_lang, ""),
        (
            f"For {source_lang}, pay special attention to the following when they are relevant "
            "to this phrase. Use only the rules that genuinely help explain the selected text. "
            "Do not treat them as a separate section; weave the relevant information naturally "
            "into the single explanation."
        ),
    )

    return BASE_PROMPT.format(
        table_guidance=table.format(**fmt),
        explanation_guidance=explanation.format(**fmt),
        **fmt,
    )


def explain_messages(
    phrase: str,
    context: str,
    source_lang: str,
    target_lang: str,
) -> list:
    system = build_explain_prompt(source_lang, target_lang)

    user = (
        f"Source language: {source_lang}\n"
        f"Target language: {target_lang}\n\n"
        f"Context:\n{context}\n\n"
        f"Phrase to explain:\n{phrase}"
    )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


FIX_JSON_PROMPT = (
    "Your previous reply was not valid JSON. Parsing it failed with this error:\n"
    "{error}\n\n"
    "Here is what you sent:\n"
    "{raw}\n\n"
    "Return the SAME information with the SAME meaning and the SAME fields, "
    "but fix only the JSON syntax. "
    'The object must contain exactly "words" and "explanation". '
    "Do not add, remove, reinterpret, or rewrite information unless required to make valid JSON. "
    "Respond with only one strictly valid JSON object, with no markdown fences and no extra text."
).strip()
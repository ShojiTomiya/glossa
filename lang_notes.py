TABLE_EXTRA = {
    "English": (
        "- Phrasal verbs: if the phrase contains a phrasal verb, treat the verb and particle "
        "as separate entries when useful. base_form of the verb entry is the full phrasal verb "
        "(for example, give up). If the particle is separated in the text, mention this in "
        "grammatical_details.\n"
        "- Verbs: base_form is the bare infinitive. Give tense, aspect (simple, continuous, "
        "perfect) and voice when relevant. For irregular forms, say which form it is "
        "(for example, past simple or past participle).\n"
        "- Contractions such as 's, 'd and 've: explain what they stand for when the context "
        "makes this relevant.\n"
        "- Nouns: give number when relevant; do not invent grammatical gender or case. "
        "Pronouns: give person, number and grammatical function/case when relevant.\n"
    ).strip(),

    "Spanish": (
        "- Verbs: base_form is the infinitive. Give tense, mood, person and number when relevant. "
        "For the subjunctive, identify the relevant trigger or construction when it helps explain "
        "why it is used. Mark irregular or stem-changing forms.\n"
        "- Verbs with attached clitics such as dámelo or decirle: split the elements when useful "
        "and explain the function of each pronoun.\n"
        "- Nouns and adjectives: give gender and number when relevant.\n"
        "- Pronouns: give person, number and grammatical function when relevant.\n"
        "- Reflexive or pronominal verbs: base_form includes se when appropriate. Distinguish "
        "reflexive, reciprocal, impersonal, passive, or purely pronominal uses when relevant.\n"
        "- Keep the personal a when it is present and grammatically meaningful.\n"
    ).strip(),

    "German": (
        "- Articles are important when they carry grammatical information such as case, gender "
        "or number. Include them when relevant to understanding the phrase.\n"
        "- Nouns: base_form is normally the nominative singular. Give gender, number and case "
        "when relevant.\n"
        "- Adjectives: base_form is the uninflected form. Give gender, number and case when "
        "relevant, and explain strong, weak or mixed declension only when it helps understand "
        "the ending.\n"
        "- Pronouns: give person, number and case when relevant.\n"
        "- Verbs: base_form is the infinitive. Give tense, mood, person and number when relevant. "
        "For participles, identify the participle and mention the auxiliary when it matters.\n"
        "- Separable verbs: when a prefix is separated, make the relationship to the full verb "
        "clear. base_form should contain the complete verb.\n"
        "- Pay particular attention to case because it can be determined by a verb, preposition, "
        "article, adjective ending, or syntactic role. For two-way prepositions such as in, auf "
        "and an, distinguish location from direction/movement when that distinction applies.\n"
    ).strip(),

    "Italian": (
        "- Articulated prepositions such as nel, dalla and sui: treat the form as a unit when "
        "appropriate and explain which preposition and article it contains, including gender "
        "and number when relevant.\n"
        "- Verbs: base_form is the infinitive. Give tense, mood, person and number when relevant. "
        "For compound tenses, mention the auxiliary when it helps explain the form.\n"
        "- Clitics: explain the function of each pronoun when relevant, including direct object, "
        "indirect object, partitive or locative uses.\n"
        "- Reflexive verbs: base_form ends in -si when appropriate.\n"
        "- Truncated and elided forms: give the full base form when useful.\n"
    ).strip(),
}


EXPLANATION_EXTRA = {
    "English": (
        "- Phrasal verbs: explain the meaning of the complete phrasal verb when that meaning is "
        "not obvious from the individual words, and mention the particle's position when useful.\n"
        "- Tense and aspect: explain why this form fits the context when the distinction matters, "
        "for example past simple vs present perfect or simple vs continuous.\n"
        "- Modal verbs and conditionals: explain the relevant meaning or nuance, such as "
        "possibility, obligation, politeness or hypothetical meaning.\n"
        "- Passive voice: explain its role when it affects the interpretation or focus of the sentence.\n"
        "- Verb patterns: explain gerund vs infinitive when the choice affects meaning.\n"
        "- Contractions such as 's and 'd: explain their interpretation when the context makes "
        "the contraction ambiguous."
    ).strip(),

    "Spanish": (
        "- Subjunctive vs indicative: when relevant, identify the construction or trigger and "
        "explain what the subjunctive contributes to the meaning in this context.\n"
        "- Past tenses: explain the relevant distinction between indefinido, imperfecto and "
        "perfecto when it affects the interpretation.\n"
        "- Ser vs estar and por vs para: explain the contextual reason for the choice when relevant.\n"
        "- Clitic pronouns: explain what they refer to and their grammatical function when useful. "
        "Explain changes such as le -> se before lo/la when present.\n"
        "- Se: distinguish reflexive, reciprocal, impersonal and passive uses when relevant.\n"
        "- Personal a and verbs such as gustar: explain their grammatical role when it helps "
        "understand the sentence."
    ).strip(),

    "German": (
        "- Case: explain which case is present and WHY when the case matters. Identify whether "
        "it is caused by a preposition, verb, construction, or syntactic role such as subject, "
        "direct object or indirect object.\n"
        "- Two-way prepositions such as in, auf and an: explain accusative vs dative when the "
        "distinction is relevant, especially direction/movement vs location.\n"
        "- Word order: explain verb position, subordinate-clause order, inversion or the position "
        "of separated verb parts only when it helps understand the selected phrase.\n"
        "- Separable verbs: explain the full verb and why its prefix is separated in this context "
        "when relevant.\n"
        "- Tense: explain Perfekt vs Präteritum when the choice affects meaning, register or narration.\n"
        "- Konjunktiv I and II: explain reported speech, hypothetical meaning, politeness or other "
        "relevant function when present.\n"
        "- Passive: explain the relevant passive construction when it affects the interpretation.\n"
        "- Modal verbs: explain obligation, permission, ability, probability or another relevant nuance.\n"
        "- Verb-preposition combinations: explain the fixed preposition and the case it requires "
        "when this is important for understanding the phrase.\n"
        "- Modal particles such as doch, ja, mal, eben and schon: explain their contextual nuance "
        "when they materially affect the meaning.\n"
        "- Adjective endings: explain why the ending has this form when that is important for "
        "understanding the phrase."
    ).strip(),

    "Italian": (
        "- Congiuntivo vs indicativo: when relevant, identify the construction that triggers the "
        "mood and explain its meaning.\n"
        "- Past tenses: explain passato prossimo, imperfetto or passato remoto when the choice "
        "matters in context.\n"
        "- Auxiliary essere vs avere: explain the choice when it helps understand the form.\n"
        "- Clitic pronouns: explain what they refer to and their grammatical function when useful.\n"
        "- Si: distinguish reflexive, impersonal and passive uses when relevant.\n"
        "- Conditional sentences: explain the relevant construction and tense relationship when useful.\n"
        "- Fixed prepositions: explain a vs in, da, di and similar choices when the preposition "
        "is important to the meaning."
    ).strip(),
}
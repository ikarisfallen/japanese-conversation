# 話そう Sentence Builder

A PWA for listening practice in casual Tokyo Japanese (タメ口). The app says a sentence, and you rebuild it left to right by picking each word (in kana) from 3–4 choices.

Sentences come from patterns with interchangeable slots (this/that, colors, objects, owners, foods, places, times, counts, adjectives…), so each round is a new combination you can't just memorize.

## On the card

- 🔊 replays the sentence.
- **Kana** shows what was said in hiragana and katakana.
- **Meaning** shows a color-coded word-by-word gloss (the same layout as jp-subtitles: furigana, Japanese and English stacked per word, each word in its own color) plus the full English sentence.

Both start hidden on every sentence.

Wrong choices are sound-alikes by default: near-misses that differ by one sound learners commonly mishear (long vs short vowels like しゅうまつ / しゅまつ, small っ like みっつ / みつ, voicing like かさ / がさ, きょ vs こ, an extra or missing ん, or one vowel off like あかい / あけい). Choices that would sound identical to the answer are filtered out. Settings → Wrong choices switches to "Different words (easy)", which uses other words from the same category. The generator is in `soundalike.js`. Wrong taps turn red and count against that sentence. Stats (sentences, perfect sentences, first-try accuracy) are stored in `localStorage` on the device.

## Run locally

```bash
python -m http.server 8080
```

Then open http://localhost:8080 in Chrome.

## Adding sentences

Edit `sentences.js`:

- **Word pools** (`POOLS`): each word is `w(jp, kana, en)`. Wrong choices for a slot come from the rest of its pool.
- **Patterns** (`PATTERNS`): `parts` lists the slots left to right. A part can be a pool (`{ pool: "color" }`), a fixed word with its own wrong choices (`{ word: w("が", "が", "(subject)"), alts: ["で", "に"] }`), or punctuation (`"、"`). `en(p)` builds the English sentence from the picks.
- `fits` limits a slot to words that make sense with earlier picks (e.g. no "this park is cheap").

## Voice recognition (on hold)

The earlier speak-your-answer version (Web Speech API plus kuromoji kana matching, with 42 hand-written drills) is in git history at commit `28b8e83`.

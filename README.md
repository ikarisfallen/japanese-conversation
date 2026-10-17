# 話そう Speaking Drills

A PWA for practicing casual Tokyo Japanese (タメ口) out loud. The app asks a question, you answer out loud, and it checks your answer against the accepted answers.

## How it works

- **Question audio:** the browser's speech synthesis (`ja-JP` voice).
- **Listening:** the Web Speech API (`ja-JP`). In Chrome on Android, audio goes to Google's speech service, so this part needs a connection.
- **Matching:** [kuromoji.js](https://github.com/takuyaa/kuromoji.js) converts both what you said and the accepted answers to hiragana, then they're compared by edit distance. 漢字 vs. かな differences don't count against you, and spoken numbers like 7時 match 七時. A score of 90% or more is correct; 70% or more is close.
- **Review:** missed cards come back at the end of the session, then Leitner-style spaced repetition (1, 3, 7, 14, 30, then 60 days). Progress is stored in `localStorage` on the device.

## Run locally

```bash
python -m http.server 8080
```

Then open http://localhost:8080 in Chrome.

## Adding drills

Edit `drills.js`. Accepted answers use a small pattern syntax:

- `[a|b]`: either a or b
- `[a|b|]`: a, b, or nothing (optional)

Example: `"[うん|]元気[だよ|]"` accepts 元気, 元気だよ, うん元気 and うん元気だよ.

Furigana comes from the `kana` and `qKana` fields, so separate words with spaces there (`きょう さむくない？`). The spaces tell the app where one word's reading ends when kanji from two words sit next to each other.

Write numbers in kanji (七時, 二年). If a kanji has two readings the tokenizer could pick (空いた = あいた/すいた), also list the kana spelling.

`vendor/kuromoji/kuromoji.js` has one local patch: the dictionary loader skips gunzip if the host already decompressed the file.

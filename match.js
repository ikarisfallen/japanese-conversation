// Answer matching: turn what the recognizer heard and the accepted answers into
// hiragana readings, then compare them with an edit-distance similarity score.
(function () {
  "use strict";

  let tokenizer = null;
  let tokenizerPromise = null;

  function loadTokenizer() {
    if (tokenizerPromise) return tokenizerPromise;
    tokenizerPromise = new Promise((resolve, reject) => {
      if (!window.kuromoji) return reject(new Error("kuromoji not loaded"));
      window.kuromoji.builder({ dicPath: "vendor/kuromoji/dict/" }).build((err, tok) => {
        if (err) return reject(err);
        tokenizer = tok;
        resolve(tok);
      });
    });
    return tokenizerPromise;
  }

  // "[a|b|]c" → ["ac", "bc", "c"]
  function expandPattern(pattern) {
    let i = 0;
    function parseSeq() {
      let results = [""];
      while (i < pattern.length && pattern[i] !== "|" && pattern[i] !== "]") {
        if (pattern[i] === "[") {
          i++;
          const options = [];
          for (;;) {
            options.push(...parseSeq());
            if (pattern[i] === "|") { i++; continue; }
            if (pattern[i] === "]") { i++; break; }
            throw new Error("Unclosed [ in pattern: " + pattern);
          }
          results = results.flatMap((r) => options.map((o) => r + o));
        } else {
          const ch = pattern[i++];
          results = results.map((r) => r + ch);
        }
      }
      return results;
    }
    const out = parseSeq();
    return [...new Set(out)].filter((s) => s.length > 0);
  }

  const DIGITS = "〇一二三四五六七八九";
  function numberToKanji(n) {
    if (n === 0) return "〇";
    if (n >= 10000) return String(n);
    let s = "";
    const units = [[1000, "千"], [100, "百"], [10, "十"]];
    for (const [value, kanji] of units) {
      const d = Math.floor(n / value);
      if (d > 0) s += (d > 1 ? DIGITS[d] : "") + kanji;
      n %= value;
    }
    if (n > 0) s += DIGITS[n];
    return s;
  }

  function normalizeText(s) {
    return s
      .normalize("NFKC")
      .replace(/\d+/g, (m) => numberToKanji(parseInt(m, 10)))
      .replace(/[\s、。,.!?「」『』（）()…・～~"'“”]/g, "");
  }

  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  function reading(s) {
    const text = normalizeText(s);
    if (!tokenizer) return toHiragana(text);
    return toHiragana(
      tokenizer
        .tokenize(text)
        .map((t) => (t.reading && t.reading !== "*" ? t.reading : t.surface_form))
        .join("")
    );
  }

  function levenshtein(a, b) {
    const A = [...a], B = [...b];
    let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
    for (let i = 1; i <= A.length; i++) {
      const cur = [i];
      for (let j = 1; j <= B.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[B.length];
  }

  function similarity(a, b) {
    const len = Math.max([...a].length, [...b].length);
    return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
  }

  const FILLERS = /^(えっと|えーと|えーっと|あのー|あの|んー|まあ)+/;

  // heardList: recognizer alternatives. patterns: drill.answers.
  function bestMatch(heardList, patterns) {
    const answers = patterns.flatMap(expandPattern).map((text) => ({ text, reading: reading(text) }));
    let best = { score: -1 };
    for (const heardRaw of heardList) {
      const heardReading = reading(heardRaw);
      const candidates = [heardReading, heardReading.replace(FILLERS, "")];
      for (const h of candidates) {
        for (const ans of answers) {
          const score = similarity(h, ans.reading);
          if (score > best.score) {
            best = { score, heard: heardRaw, heardReading: h, expected: ans.text, expectedReading: ans.reading };
          }
        }
      }
    }
    return best;
  }

  function verdict(score) {
    if (score >= 0.9) return "correct";
    if (score >= 0.7) return "close";
    return "wrong";
  }

  // Character diff (LCS) between expected and heard readings.
  // Returns [{type: "same" | "missing" | "extra", text}]
  function diff(expected, heard) {
    const A = [...expected], B = [...heard];
    const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    const push = (type, ch) => {
      const last = ops[ops.length - 1];
      if (last && last.type === type) last.text += ch;
      else ops.push({ type, text: ch });
    };
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push("missing", A[i++]);
      else push("extra", B[j++]);
    }
    while (i < A.length) push("missing", A[i++]);
    while (j < B.length) push("extra", B[j++]);
    return ops;
  }

  // Words with character offsets and hiragana readings, or null before the dictionary loads.
  function words(text) {
    if (!tokenizer) return null;
    let pos = 0;
    return tokenizer.tokenize(text).map((t) => {
      const start = pos;
      pos += [...t.surface_form].length;
      const r = t.reading && t.reading !== "*" ? toHiragana(t.reading) : null;
      return { start, end: pos, surface: t.surface_form, reading: r };
    });
  }

  window.Matcher = {
    loadTokenizer,
    isReady: () => !!tokenizer,
    words,
    expandPattern,
    reading,
    similarity,
    bestMatch,
    verdict,
    diff,
  };
})();

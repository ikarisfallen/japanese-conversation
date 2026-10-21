// Sound-alike wrong choices: near-misses of a word that differ by one sound
// learners commonly mishear (long vowels, small っ, voicing, きょ/こ, ん, one vowel).
// Candidates that would sound identical to the real word (えいが / ええが) are dropped.
(function () {
  "use strict";

  const VOWELS = "aiueo";
  const ROWS = {
    "": "あいうえお", k: "かきくけこ", g: "がぎぐげご", s: "さしすせそ", z: "ざじずぜぞ",
    t: "たちつてと", d: "だぢづでど", n: "なにぬねの", h: "はひふへほ", b: "ばびぶべぼ",
    p: "ぱぴぷぺぽ", m: "まみむめも", y: "や ゆ よ", r: "らりるれろ", w: "わ   を",
  };
  const INFO = {}; // char → {c, v}
  for (const [c, chars] of Object.entries(ROWS)) {
    [...chars].forEach((ch, i) => { if (ch !== " ") INFO[ch] = { c, v: VOWELS[i] }; });
  }
  const at = (c, v) => {
    const ch = (ROWS[c] || "")[VOWELS.indexOf(v)];
    return ch && ch !== " " ? ch : null;
  };
  const SMALL = { ゃ: "a", ゅ: "u", ょ: "o" };
  const SMALL_FOR = { a: "ゃ", u: "ゅ", o: "ょ" };
  const VOICE = { k: ["g"], g: ["k"], s: ["z"], z: ["s"], t: ["d"], d: ["t"], h: ["b", "p"], b: ["h", "p"], p: ["b", "h"] };
  const VOWEL_SHIFT = { a: ["o"], o: ["u", "a"], u: ["o"], e: ["i"], i: ["e"] };
  const LONG_FOR = { a: "あ", i: "い", u: "う", e: "い", o: "う" };
  const GEMINATE = new Set(["k", "s", "t", "p"]);

  const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const isKata = (ch) => /[ァ-ヺ]/.test(ch);

  // "しゅうまつ" → ["しゅ", "う", "ま", "つ"]
  function morae(s) {
    const out = [];
    for (const ch of s) {
      if (SMALL[ch] && out.length) out[out.length - 1] += ch;
      else out.push(ch);
    }
    return out;
  }
  // Vowel a mora ends on ("しゅ" → u, "ー"/"っ"/"ん" → null).
  function vowelOf(m) {
    if (m.length === 2 && SMALL[m[1]]) return SMALL[m[1]];
    return INFO[m] ? INFO[m].v : null;
  }
  // Is morae[i] stretching the vowel before it? (ー, おう, えい, かあ…)
  function isLong(ms, i) {
    if (i === 0) return false;
    const prev = vowelOf(ms[i - 1]);
    const m = ms[i];
    if (m === "ー") return true;
    if (!prev) return false;
    return (m === "う" && (prev === "o" || prev === "u")) || (m === "い" && (prev === "e" || prev === "i"))
      || (m === "あ" && prev === "a") || (m === "お" && prev === "o") || (m === "え" && prev === "e");
  }

  // How a hiragana string sounds: long vowels normalized, so homophones compare equal.
  function soundKey(s) {
    const ms = morae(toHira(s));
    return ms.map((m, i) => (isLong(ms, i) ? ":" : m)).join("");
  }

  // Every single-sound change of a hiragana string (katakana mode uses ー for long vowels).
  function mutations(s, kata) {
    const ms = morae(s);
    const out = [];
    const put = (i, del, ...ins) => out.push([...ms.slice(0, i), ...ins, ...ms.slice(i + del)].join(""));
    ms.forEach((m, i) => {
      const base = m[0];
      const info = INFO[base];
      const youon = m.length === 2;
      // Voicing: か ↔ が, は ↔ ば ↔ ぱ …
      if (info && VOICE[info.c]) {
        for (const c of VOICE[info.c]) {
          const ch = at(c, info.v);
          if (ch && !"ぢづ".includes(ch)) put(i, 1, ch + m.slice(1));
        }
      }
      // Small っ: drop it, or double the next consonant.
      if (m === "っ") put(i, 1);
      else if (i > 0 && info && GEMINATE.has(info.c) && !["っ", "ん", "ー"].includes(ms[i - 1])) put(i, 0, "っ");
      // Long vowels: drop the stretch, or add one (not right before a bare vowel: あおうい).
      const nextIsVowel = i + 1 < ms.length && INFO[ms[i + 1]] && INFO[ms[i + 1]].c === "";
      if (isLong(ms, i)) put(i, 1);
      else {
        const v = vowelOf(m);
        if (v && !nextIsVowel && !(i + 1 < ms.length && isLong(ms, i + 1))) put(i + 1, 0, kata ? "ー" : LONG_FOR[v]);
      }
      // きょ ↔ こ, しゅ ↔ す …
      if (youon && info) {
        const plain = at(info.c, SMALL[m[1]]);
        if (plain) put(i, 1, plain);
      } else if (info && info.c && !"ywd".includes(info.c) && SMALL_FOR[info.v] && !isLong(ms, i)) {
        const iRow = at(info.c, "i");
        if (iRow) put(i, 1, iRow + SMALL_FOR[info.v]);
      }
      // ん: drop it, or add one.
      if (m === "ん") put(i, 1);
      else if (i > 0 && i < ms.length - 1 && ms[i + 1] !== "ん" && !nextIsVowel && vowelOf(m)) put(i + 1, 0, "ん");
      // One vowel off: あかい → あけい (not on a long-vowel stretch).
      if (info && !youon && !isLong(ms, i)) {
        for (const v of VOWEL_SHIFT[info.v]) {
          const ch = at(info.c, v);
          if (ch && !"ぢづを".includes(ch)) put(i, 1, ch);
        }
      }
    });
    return out;
  }

  function valid(s) {
    return s.length > 0
      && !/^[っんーゃゅょ]/.test(s)
      && !/っ$/.test(s)
      && !/(っっ|っん|んっ|ーー|っー|ーっ|んん|ぢ|づ)/.test(s);
  }

  // Split into script runs so a mixed word (テレビのまえ) keeps each part's script.
  function runs(kana) {
    const out = [];
    for (const ch of kana) {
      const kata = isKata(ch) || (ch === "ー" && out.length && out[out.length - 1].kata);
      const last = out[out.length - 1];
      if (last && last.kata === kata) last.text += ch;
      else out.push({ kata, text: ch });
    }
    return out;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Up to n sound-alikes of `kana`, avoiding anything that sounds like `kana`
  // or like each other. `similarWords` (real words) are preferred when they're close.
  function soundAlikes(kana, n, similarWords = []) {
    const target = soundKey(kana);
    const seen = new Set([target]);
    const out = [];
    const add = (s) => {
      const key = soundKey(s);
      if (!valid(toHira(s)) || seen.has(key)) return;
      seen.add(key);
      out.push(s);
    };
    // A real word that's one sound off (あかい / あおい), or that the answer
    // extends (いく / いくよ), makes a great trap.
    for (const w of shuffle(similarWords)) {
      if (out.length >= 1) break;
      const key = soundKey(w);
      const close = editDistance(key, target) <= Math.max(1, Math.floor([...target].length / 4));
      const extends_ = key.startsWith(target) || target.startsWith(key);
      if (close || extends_) add(w);
    }
    const parts = runs(kana);
    const candidates = [];
    parts.forEach((r, ri) => {
      for (const m of mutations(toHira(r.text), r.kata)) {
        const text = r.kata ? toKata(m) : m;
        candidates.push(parts.map((p, j) => (j === ri ? text : p.text)).join(""));
      }
    });
    for (const c of shuffle(candidates)) {
      if (out.length >= n) break;
      add(c);
    }
    return out;
  }

  function editDistance(a, b) {
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

  window.SoundAlike = { soundAlikes, soundKey, mutations };
})();

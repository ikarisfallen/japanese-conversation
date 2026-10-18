// Furigana: line up a word's kanji with its kana reading and render them as
// <ruby>. Each run of consecutive kanji gets one reading (机の上 → 机(つくえ)の上(うえ)).
(function () {
  "use strict";

  const KANJI = /[一-鿿々〆ヶ]/;
  const KANA = /[ぁ-ゖァ-ヺー]/;

  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // "今帰ってるとこ" → [{kanji,"今帰",start:0}, {kana,"ってるとこ",start:2}]
  function segment(text) {
    const segs = [];
    let pos = 0;
    for (const ch of text) {
      const type = KANJI.test(ch) ? "kanji" : KANA.test(ch) ? "kana" : "other";
      const last = segs[segs.length - 1];
      if (last && last.type === type) last.text += ch;
      else segs.push({ type, text: ch, start: pos });
      pos++;
    }
    return segs;
  }

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Returns segments with .reading on kanji runs, or null if text and kana don't line up.
  function align(text, kana) {
    const segs = segment(text);
    const reading = toHiragana(kana.normalize("NFKC"))
      .replace(/[^ぁ-ゖー]+/g, " ")
      .trim();
    const pattern = segs
      .map((s) =>
        s.type === "kanji" ? "(.+?)"
        : s.type === "kana" ? [...toHiragana(s.text)].map(escape).join(" ?")
        : "(?: |^|$)") // punctuation is a word break in the reading too
      .join(" ?");
    const m = new RegExp(`^${pattern}$`).exec(reading);
    if (!m) return null;

    let g = 1;
    for (const s of segs) if (s.type === "kanji") s.reading = m[g++].trim();
    return segs;
  }

  // Build a DocumentFragment with <ruby> for kanji runs; plain text if alignment fails.
  function render(text, kana) {
    const frag = document.createDocumentFragment();
    const segs = kana && align(text, kana);
    if (!segs) {
      frag.append(text);
      return { node: frag, ok: false };
    }
    for (const s of segs) {
      if (s.type !== "kanji") { frag.append(s.text); continue; }
      const ruby = document.createElement("ruby");
      const rt = document.createElement("rt");
      rt.textContent = s.reading;
      ruby.append(s.text, rt);
      frag.append(ruby);
    }
    return { node: frag, ok: true };
  }

  // Interlinear gloss, styled after jp-subtitles: each word is a stack of
  // furigana / Japanese / English, and each word gets its own color (wc0–wc7).
  // words: [{jp, kana, en} | {punct}]
  const WORD_COLORS = 8;
  const colorClass = (i) => `wc${i % WORD_COLORS}`;

  function renderWords(words) {
    const line = document.createElement("span");
    line.className = "gloss-line";
    let color = 0;
    for (const w of words) {
      const word = document.createElement("span");
      const jp = document.createElement("span");
      jp.className = "gw-jp";
      const en = document.createElement("span");
      en.className = "gw-en";
      if (w.punct) {
        word.className = "gw gw-punct";
        jp.textContent = w.punct;
      } else {
        word.className = `gw ${colorClass(color++)}`;
        jp.append(render(w.jp, w.kana).node);
        en.textContent = w.en;
      }
      word.append(jp, en);
      line.append(word);
    }
    return line;
  }

  window.Furigana = { align, render, renderWords, colorClass };
})();

// Furigana: line up a sentence's kanji with the readings in drill.kana and
// render them as <ruby>. Each run of consecutive kanji gets one reading.
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

  // A kanji run can span words (今日寒 = きょう さむ). drill.kana marks words with spaces,
  // so split the run where the dictionary's word boundaries agree with those spaces;
  // otherwise keep one reading over the whole run.
  function splitRun(seg, words) {
    const parts = seg.reading.split(" ");
    if (parts.length === 1) return [seg];
    const joined = { ...seg, reading: parts.join("") };
    if (!words) return [joined];
    const chars = [...seg.text];
    const end = seg.start + chars.length;
    const cuts = words.map((w) => w.end).filter((p) => p > seg.start && p < end);
    const options = choose(cuts, parts.length - 1).map((picked) => {
      const bounds = [seg.start, ...picked, end];
      return parts.map((r, i) => ({
        type: "kanji",
        text: chars.slice(bounds[i] - seg.start, bounds[i + 1] - seg.start).join(""),
        start: bounds[i],
        end: bounds[i + 1],
        reading: r,
      }));
    });
    // Prefer a split where each piece's reading fits the dictionary's reading of its words.
    const fits = (p) => {
      const ws = words.filter((w) => w.start < p.end && w.end > p.start);
      return ws.some((w) => !w.reading) || ws.map((w) => w.reading).join("").includes(p.reading);
    };
    const good = options.find((pieces) => pieces.every(fits));
    if (good) return good;
    // Only one possible split (e.g. 空いてる read あいてる by the dictionary): trust the spaces.
    return options.length === 1 ? options[0] : [joined];
  }

  // All ways to pick k items from arr, in order.
  function choose(arr, k) {
    if (k === 0) return [[]];
    const out = [];
    arr.forEach((x, i) => choose(arr.slice(i + 1), k - 1).forEach((rest) => out.push([x, ...rest])));
    return out;
  }

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
    const words = window.Matcher && window.Matcher.words(text);
    return segs.flatMap((s) => (s.type === "kanji" ? splitRun(s, words) : [s]));
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

  window.Furigana = { align, render };
})();

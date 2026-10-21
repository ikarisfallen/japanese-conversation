(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ── Storage ────────────────────────────────────
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback };
    } catch { return { ...fallback }; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }

  const allCats = Object.keys(window.CATEGORIES);
  const settings = load("sb-settings", { rate: 0.9, voice: "", count: 10, cats: allCats, choices: "similar" });
  settings.cats = settings.cats.filter((c) => allCats.includes(c));
  if (!settings.cats.length) settings.cats = allCats;

  const EMPTY_STATS = { played: 0, perfect: 0, slots: 0, firstTry: 0 };
  let stats = load("sb-stats", EMPTY_STATS);

  // ── Speech synthesis ────────────────────────────
  let voices = [];
  function refreshVoices() {
    voices = speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").startsWith("ja"));
    const sel = $("set-voice");
    sel.innerHTML = "";
    if (!voices.length) {
      sel.add(new Option("Default Japanese", ""));
      return;
    }
    for (const v of voices) sel.add(new Option(v.name, v.name));
    if (!voices.some((v) => v.name === settings.voice)) {
      const preferred = voices.find((v) => /google/i.test(v.name)) || voices[0];
      settings.voice = preferred.name;
    }
    sel.value = settings.voice;
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = settings.rate;
    const v = voices.find((v) => v.name === settings.voice);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  // ── Round state ─────────────────────────────────
  let round = null;
  // { sentences: [...], index, results: [{sentence, mistakes}], step, mistakes, slotMissed }

  function startRound() {
    const patterns = window.PATTERNS.filter((p) => settings.cats.includes(p.cat));
    const sentences = [];
    let last = null;
    for (let i = 0; i < settings.count; i++) {
      // Avoid the same pattern twice in a row when there's a choice.
      const options = patterns.length > 1 ? patterns.filter((p) => p !== last) : patterns;
      last = options[Math.floor(Math.random() * options.length)];
      sentences.push(window.Sentences.generate(last, settings.choices));
    }
    round = { sentences, index: 0, results: [] };
    show("drill");
    showSentence();
  }

  const current = () => round.sentences[round.index];
  // Indexes of the words you pick (everything except punctuation).
  const slots = (s) => s.words.map((w, i) => (w.punct ? -1 : i)).filter((i) => i >= 0);

  function showSentence() {
    const s = current();
    round.step = 0;         // which slot you're on
    round.mistakes = 0;
    round.slotMissed = false;
    $("card-cat").textContent = window.CATEGORIES[s.pattern.cat];
    setToggle("btn-kana", false);
    setToggle("btn-meaning", false);
    $("result").hidden = true;
    $("choices").hidden = false;
    $("progress-bar").style.width = `${(round.index / round.sentences.length) * 100}%`;
    $("progress-text").textContent = `${round.index + 1} / ${round.sentences.length}`;
    renderBuilt();
    renderChoices();
    speak(s.say);
  }

  // ── Transcript toggles ──────────────────────────
  // Kana: what was said in hiragana/katakana. Meaning: colored gloss with kanji + English.
  function setToggle(id, on) {
    $(id).setAttribute("aria-pressed", on);
    renderTranscript();
  }
  const isOn = (id) => $(id).getAttribute("aria-pressed") === "true";

  function kanaLine(words) {
    // Space between words, but not around punctuation.
    let out = "";
    let prevWord = false;
    for (const w of words) {
      out += w.punct || (prevWord ? " " : "") + w.kana;
      prevWord = !w.punct;
    }
    return out;
  }

  function renderTranscript() {
    if (!round) return;
    const s = current();
    const el = $("transcript");
    $("meaning-en").hidden = !isOn("btn-meaning");
    $("meaning-en").textContent = s.en;
    if (isOn("btn-meaning")) {
      el.className = "jp transcript";
      el.replaceChildren(window.Furigana.renderWords(s.words));
    } else if (isOn("btn-kana")) {
      el.className = "jp transcript kana-line";
      el.textContent = kanaLine(s.words);
    } else {
      el.className = "transcript placeholder";
      el.textContent = "Listen, then build the sentence";
    }
  }

  // ── Builder ─────────────────────────────────────
  function renderBuilt() {
    const s = current();
    const el = $("built");
    el.className = "built jp";
    el.replaceChildren();
    const done = slots(s).slice(0, round.step);
    const nextSlot = slots(s)[round.step] ?? Infinity;
    let color = 0;
    s.words.forEach((w, i) => {
      const span = document.createElement("span");
      if (w.punct) {
        // Punctuation appears once you've built everything before it.
        if (i > nextSlot || done.length === 0) return;
        span.className = "built-punct";
        span.textContent = w.punct;
      } else if (done.includes(i)) {
        span.className = `chip-word ${window.Furigana.colorClass(color)}`;
        span.textContent = w.kana;
      } else {
        span.className = "blank";
        span.textContent = "?";
      }
      if (!w.punct) color++;
      el.append(span);
    });
  }

  function renderChoices() {
    const s = current();
    const el = $("choices");
    el.replaceChildren();
    const word = s.words[slots(s)[round.step]];
    for (const k of word.choices) {
      const b = document.createElement("button");
      b.className = "choice";
      b.textContent = k;
      b.onclick = () => choose(b, k, word);
      el.append(b);
    }
  }

  function choose(button, kana, word) {
    if (kana !== word.kana) {
      round.mistakes++;
      round.slotMissed = true;
      button.classList.add("wrong");
      button.disabled = true;
      if (navigator.vibrate) navigator.vibrate(60);
      return;
    }
    stats.slots++;
    if (!round.slotMissed) stats.firstTry++;
    round.slotMissed = false;
    round.step++;
    renderBuilt();
    if (round.step < slots(current()).length) renderChoices();
    else finishSentence();
  }

  function finishSentence() {
    const s = current();
    round.results.push({ sentence: s, mistakes: round.mistakes });
    stats.played++;
    if (round.mistakes === 0) stats.perfect++;
    save("sb-stats", stats);

    $("choices").hidden = true;
    $("built").className = "built jp complete";
    $("built").replaceChildren(window.Furigana.renderWords(s.words));
    const v = $("verdict");
    if (round.mistakes === 0) { v.className = "verdict correct"; v.textContent = "完璧！ Perfect."; }
    else {
      v.className = `verdict ${round.mistakes <= 2 ? "close" : "wrong"}`;
      v.textContent = `Done — ${round.mistakes} wrong tap${round.mistakes > 1 ? "s" : ""}`;
    }
    $("result-en").textContent = s.en;
    $("result").hidden = false;
    $("btn-next").focus();
    speak(s.say);
  }

  function next() {
    round.index++;
    if (round.index >= round.sentences.length) finish();
    else showSentence();
  }

  function finish() {
    speechSynthesis.cancel();
    const results = round.results;
    const perfect = results.filter((r) => r.mistakes === 0).length;
    $("done-text").textContent = `${results.length} sentences · ${perfect} perfect`;
    const list = $("done-list");
    list.replaceChildren();
    for (const r of results) {
      const li = document.createElement("li");
      const text = document.createElement("span");
      const jp = document.createElement("span");
      jp.className = "jp";
      jp.textContent = r.sentence.jp;
      const en = document.createElement("small");
      en.className = "muted";
      en.textContent = r.sentence.en;
      text.append(jp, document.createElement("br"), en);
      const tag = document.createElement("span");
      tag.className = r.mistakes === 0 ? "tag-correct" : r.mistakes <= 2 ? "tag-close" : "tag-wrong";
      tag.textContent = r.mistakes === 0 ? "✓" : `✗${r.mistakes}`;
      li.append(text, tag);
      list.append(li);
    }
    round = null;
    show("done");
  }

  // ── Views ──────────────────────────────────────
  function show(name) {
    for (const v of ["home", "drill", "done"]) $(`view-${v}`).hidden = v !== name;
    if (name === "home") renderHome();
    window.scrollTo(0, 0);
  }

  function renderHome() {
    $("stat-played").textContent = stats.played;
    $("stat-perfect").textContent = stats.perfect;
    $("stat-accuracy").textContent = stats.slots ? `${Math.round((stats.firstTry / stats.slots) * 100)}%` : "–";
    $("btn-start").textContent = `Start · ${settings.count} sentences`;
    $("btn-start").disabled = settings.cats.length === 0;

    const cats = $("cats");
    cats.replaceChildren();
    for (const [key, label] of Object.entries(window.CATEGORIES)) {
      const b = document.createElement("button");
      b.className = "chip jp";
      b.textContent = label;
      b.setAttribute("aria-pressed", settings.cats.includes(key));
      b.onclick = () => {
        settings.cats = settings.cats.includes(key)
          ? settings.cats.filter((c) => c !== key)
          : [...settings.cats, key];
        save("sb-settings", settings);
        renderHome();
      };
      cats.append(b);
    }
  }

  // ── Wiring ─────────────────────────────────────
  function init() {
    if (!("speechSynthesis" in window)) {
      $("env-warning").hidden = false;
      $("env-warning").textContent = "This browser can't speak Japanese aloud. Use Chrome on Android or desktop.";
    } else {
      refreshVoices();
      speechSynthesis.onvoiceschanged = refreshVoices;
    }

    $("set-count").value = settings.count;
    $("set-choices").value = settings.choices;
    $("set-choices").onchange = (e) => { settings.choices = e.target.value; save("sb-settings", settings); };
    $("set-rate").value = settings.rate;
    $("rate-out").textContent = `${settings.rate}×`;
    $("set-count").onchange = (e) => {
      settings.count = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 10));
      e.target.value = settings.count;
      save("sb-settings", settings);
      renderHome();
    };
    $("set-rate").oninput = (e) => {
      settings.rate = parseFloat(e.target.value);
      $("rate-out").textContent = `${settings.rate}×`;
      save("sb-settings", settings);
    };
    $("set-voice").onchange = (e) => {
      settings.voice = e.target.value;
      save("sb-settings", settings);
      speak("これ、赤いボールだよ");
    };
    $("btn-reset").onclick = () => {
      if (!confirm("Reset your stats?")) return;
      stats = { ...EMPTY_STATS };
      save("sb-stats", stats);
      renderHome();
    };

    $("btn-start").onclick = startRound;
    $("btn-quit").onclick = () => {
      speechSynthesis.cancel();
      if (round.results.length) finish();
      else { round = null; show("home"); }
    };
    $("btn-say").onclick = () => speak(current().say);
    $("btn-kana").onclick = () => setToggle("btn-kana", !isOn("btn-kana"));
    $("btn-meaning").onclick = () => setToggle("btn-meaning", !isOn("btn-meaning"));
    $("btn-next").onclick = next;
    $("btn-home").onclick = () => show("home");

    show("home");

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  init();
})();

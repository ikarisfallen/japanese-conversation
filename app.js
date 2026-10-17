(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DAY = 24 * 60 * 60 * 1000;
  // Leitner boxes: days until the next review after a correct answer.
  const INTERVALS = [0, 1, 3, 7, 14, 30, 60];

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

  const settings = load("jc-settings", {
    showQ: "always",
    autoListen: false,
    rate: 0.95,
    newPerSession: 8,
    voice: "",
    cats: Object.keys(window.CATEGORIES),
  });
  let progress = load("jc-progress", {}); // id → {box, due, reps, lapses}

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
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      u.rate = settings.rate;
      const v = voices.find((v) => v.name === settings.voice);
      if (v) u.voice = v;
      // Chrome on Android sometimes never fires onend; fall back to a timer.
      const timer = setTimeout(resolve, 1500 + text.length * 250 / settings.rate);
      u.onend = u.onerror = () => { clearTimeout(timer); resolve(); };
      speechSynthesis.speak(u);
    });
  }

  // ── Speech recognition ──────────────────────────
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;

  function listen(onInterim) {
    return new Promise((resolve, reject) => {
      const rec = new Recognition();
      recognizer = rec;
      rec.lang = "ja-JP";
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      rec.continuous = false;
      let finals = [];
      let lastInterim = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finals = Array.from(r, (alt) => alt.transcript);
          else interim += r[0].transcript;
        }
        lastInterim = interim || lastInterim;
        onInterim(finals[0] || interim);
      };
      rec.onerror = (e) => {
        recognizer = null;
        if (e.error === "no-speech" || e.error === "aborted") resolve([]);
        else reject(e.error);
      };
      rec.onend = () => {
        recognizer = null;
        resolve(finals.length ? finals : lastInterim ? [lastInterim] : []);
      };
      rec.start();
    });
  }

  // ── Scheduling ──────────────────────────────────
  function inSelectedCats(d) { return settings.cats.includes(d.cat); }
  function dueCards() {
    const now = Date.now();
    return window.DRILLS.filter((d) => inSelectedCats(d) && progress[d.id] && progress[d.id].due <= now);
  }
  function newCards() { return window.DRILLS.filter((d) => inSelectedCats(d) && !progress[d.id]); }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function schedule(id, result) {
    const p = progress[id] || { box: 0, due: 0, reps: 0, lapses: 0 };
    p.reps++;
    if (result === "correct") p.box = Math.min(p.box + 1, INTERVALS.length - 1);
    else if (result === "wrong") { p.box = 0; p.lapses++; }
    // "close" keeps the same box
    p.due = Date.now() + INTERVALS[p.box] * DAY;
    progress[id] = p;
    save("jc-progress", progress);
  }

  // ── Session state ───────────────────────────────
  let session = null;
  // {queue: [drill], index, results: Map(id → verdict), requeued: Set, attempt: {verdict, overridden}}

  function startSession(cards) {
    if (!cards.length) return;
    session = { queue: cards, index: 0, results: new Map(), requeued: new Set(), attempt: null };
    show("drill");
    showCard();
  }

  function current() { return session.queue[session.index]; }

  // Replace an element's content with furigana-annotated text. Returns false if it fell back to plain text.
  function setRuby(el, text, kana) {
    const { node, ok } = window.Furigana.render(text, kana);
    el.replaceChildren(node);
    return ok;
  }

  // Color-coded word-by-word gloss (furigana / Japanese / English per word);
  // falls back to plain furigana if the drill has no gloss.
  function setGloss(el, text, kana, gloss) {
    const line = gloss && window.Furigana.renderGloss(text, kana, gloss);
    if (line) el.replaceChildren(line);
    else setRuby(el, text, kana);
  }

  // "Meaning" toggle: English translation of the question + the glossed question.
  function setMeaning(on) {
    const d = current();
    $("btn-meaning").setAttribute("aria-pressed", on);
    $("q-meaning").hidden = !on;
    $("q-meaning").textContent = d.qEn || "";
    if (on) {
      setGloss($("card-q"), d.q, d.qKana, d.qGloss);
      $("card-q").hidden = false;
      $("card-q-hidden").hidden = true;
    } else {
      $("card-q").textContent = d.q;
    }
  }

  // "Answer" toggle: the glossed model answer. Peeking stops the card from moving up a box.
  function setHint(on) {
    const d = current();
    $("btn-hint").setAttribute("aria-pressed", on);
    $("a-hint").hidden = !on;
    if (on) {
      setGloss($("a-hint"), d.model, d.kana, d.gloss);
      session.peeked = true;
    }
  }

  function showCard() {
    const d = current();
    session.attempt = null;
    session.peeked = false;
    $("card-cat").textContent = window.CATEGORIES[d.cat];
    $("card-cue").textContent = d.cue;
    setMeaning(false);
    setHint(false);
    $("btn-hint").hidden = false;
    const hideQ = settings.showQ === "after";
    $("card-q").hidden = hideQ;
    $("card-q-hidden").hidden = !hideQ;
    $("result").hidden = true;
    $("listen-area").hidden = false;
    $("interim").textContent = "";
    $("type-form").hidden = true;
    $("type-input").value = "";
    updateProgress();
    askQuestion();
  }

  async function askQuestion() {
    const d = current();
    await speak(d.q);
    if (settings.autoListen && session && current() === d && !$("listen-area").hidden && !recognizer) {
      startListening();
    }
  }

  function updateProgress() {
    const total = session.queue.length;
    $("progress-bar").style.width = `${(session.index / total) * 100}%`;
    $("progress-text").textContent = `${session.index + 1} / ${total}`;
  }

  async function startListening() {
    if (!Recognition) return;
    if (recognizer) { recognizer.stop(); return; }
    speechSynthesis.cancel();
    const mic = $("btn-mic");
    mic.classList.add("listening");
    $("mic-hint").textContent = "Listening… tap to stop";
    $("interim").textContent = "";
    try {
      const heard = await listen((t) => { $("interim").textContent = t; });
      if (heard.length) grade(heard);
      else $("mic-hint").textContent = "Didn't catch that — tap and try again";
    } catch (err) {
      $("mic-hint").textContent =
        err === "not-allowed" ? "Microphone blocked — allow it in site settings" :
        err === "network" ? "Speech recognition needs an internet connection" :
        `Recognition error: ${err}`;
    } finally {
      mic.classList.remove("listening");
      if ($("mic-hint").textContent.startsWith("Listening")) $("mic-hint").textContent = "Tap and answer out loud";
    }
  }

  function grade(heardList) {
    const d = current();
    const m = window.Matcher.bestMatch(heardList, d.answers);
    const v = window.Matcher.verdict(m.score);
    if (!session.attempt) session.attempt = { verdict: v, overridden: false, peeked: session.peeked };
    renderResult(d, m, v);
  }

  const VERDICT_TEXT = {
    correct: "正解！ Nice.",
    close: "Almost — check the highlighted sounds",
    wrong: "Not quite — listen and try again",
  };

  const POLITE = /(です|ます|ました|ません|でした|ましょう)/;

  function renderResult(d, m, v) {
    $("listen-area").hidden = true;
    $("result").hidden = false;
    $("card-q").hidden = false;
    $("card-q-hidden").hidden = true;
    // The model answer is shown below, so the Answer toggle isn't needed now.
    $("btn-hint").hidden = true;
    $("a-hint").hidden = true;

    const verdictEl = $("verdict");
    verdictEl.className = `verdict ${v}`;
    verdictEl.textContent = `${VERDICT_TEXT[v]} (${Math.round(m.score * 100)}%)`;
    if (POLITE.test(m.heard) && !POLITE.test(d.model)) {
      verdictEl.textContent += " · That's polite form — use タメ口 (casual) here";
    }
    if (session.attempt.peeked && v === "correct") {
      verdictEl.textContent += " · used the answer, so it'll come back sooner";
    }

    $("heard-text").textContent = m.heard;
    const diffEl = $("heard-diff");
    diffEl.innerHTML = "";
    if (v !== "correct") {
      for (const op of window.Matcher.diff(m.expectedReading, m.heardReading)) {
        const span = document.createElement("span");
        span.className = op.type;
        span.textContent = op.text;
        if (op.type === "missing") span.title = "expected but not heard";
        if (op.type === "extra") span.title = "heard but not expected";
        diffEl.appendChild(span);
      }
    }

    // With furigana on the model answer, the separate kana line is only needed as a fallback.
    $("model-kana").hidden = setRuby($("model-text"), d.model, d.kana);
    $("model-kana").textContent = d.kana;
    $("model-en").textContent = d.en;
    $("model-note").textContent = d.note || "";
    $("btn-override").hidden = v === "correct" || session.attempt.overridden;
    $("btn-next").focus();
    speak(d.model);
  }

  function next() {
    const d = current();
    let result = session.attempt ? session.attempt.verdict : "wrong";
    if (result === "correct" && session.attempt.peeked) result = "close";
    if (!session.results.has(d.id)) {
      session.results.set(d.id, result);
      schedule(d.id, result);
    }
    // See missed cards once more at the end of the session.
    if (result === "wrong" && !session.requeued.has(d.id)) {
      session.requeued.add(d.id);
      session.queue.push(d);
    }
    session.index++;
    if (session.index >= session.queue.length) finish();
    else showCard();
  }

  function finish() {
    if (recognizer) recognizer.abort();
    speechSynthesis.cancel();
    const results = session.results;
    const counts = { correct: 0, close: 0, wrong: 0 };
    results.forEach((v) => counts[v]++);
    $("done-text").textContent =
      `${results.size} cards · ${counts.correct} correct · ${counts.close} close · ${counts.wrong} missed`;
    const list = $("done-list");
    list.innerHTML = "";
    const labels = { correct: "正解", close: "惜しい", wrong: "もう一回" };
    results.forEach((v, id) => {
      const d = window.DRILLS.find((x) => x.id === id);
      const li = document.createElement("li");
      const q = document.createElement("span");
      q.className = "jp";
      q.textContent = d.model;
      const tag = document.createElement("span");
      tag.className = `tag-${v} jp`;
      tag.textContent = labels[v];
      li.append(q, tag);
      list.appendChild(li);
    });
    session = null;
    show("done");
  }

  // ── Views ──────────────────────────────────────
  function show(name) {
    for (const v of ["home", "drill", "done"]) $(`view-${v}`).hidden = v !== name;
    if (name === "home") renderHome();
    window.scrollTo(0, 0);
  }

  function renderHome() {
    const due = dueCards().length;
    const fresh = newCards().length;
    $("stat-due").textContent = due;
    $("stat-new").textContent = fresh;
    $("stat-learned").textContent = Object.values(progress).filter((p) => p.box >= 2).length;
    const toDo = due + Math.min(fresh, settings.newPerSession);
    $("btn-start").disabled = toDo === 0;
    $("btn-start").textContent = toDo ? `Start drill · ${toDo} cards` : "All caught up 🎉";

    const cats = $("cats");
    cats.innerHTML = "";
    for (const [key, label] of Object.entries(window.CATEGORIES)) {
      const b = document.createElement("button");
      b.className = "chip jp";
      b.textContent = label;
      b.setAttribute("aria-pressed", settings.cats.includes(key));
      b.onclick = () => {
        settings.cats = settings.cats.includes(key)
          ? settings.cats.filter((c) => c !== key)
          : [...settings.cats, key];
        save("jc-settings", settings);
        renderHome();
      };
      cats.appendChild(b);
    }
  }

  // ── Wiring ─────────────────────────────────────
  function init() {
    if (!Recognition) {
      $("env-warning").hidden = false;
      $("env-warning").textContent =
        "This browser doesn't support speech recognition. Use Chrome on Android (or desktop Chrome/Edge). You can still type answers.";
      $("btn-mic").disabled = true;
    }

    $("dict-status").textContent = "Loading Japanese dictionary…";
    window.Matcher.loadTokenizer()
      .then(() => { $("dict-status").textContent = ""; })
      .catch(() => { $("dict-status").textContent = "Dictionary failed to load — matching will be less forgiving about kanji vs. kana."; });

    if ("speechSynthesis" in window) {
      refreshVoices();
      speechSynthesis.onvoiceschanged = refreshVoices;
    }

    // Settings
    $("set-showq").value = settings.showQ;
    $("set-autolisten").checked = settings.autoListen;
    $("set-rate").value = settings.rate;
    $("rate-out").textContent = `${settings.rate}×`;
    $("set-new").value = settings.newPerSession;
    $("set-showq").onchange = (e) => { settings.showQ = e.target.value; save("jc-settings", settings); };
    $("set-autolisten").onchange = (e) => { settings.autoListen = e.target.checked; save("jc-settings", settings); };
    $("set-rate").oninput = (e) => {
      settings.rate = parseFloat(e.target.value);
      $("rate-out").textContent = `${settings.rate}×`;
      save("jc-settings", settings);
    };
    $("set-new").onchange = (e) => {
      settings.newPerSession = Math.max(1, Math.min(40, parseInt(e.target.value, 10) || 8));
      save("jc-settings", settings);
      renderHome();
    };
    $("set-voice").onchange = (e) => {
      settings.voice = e.target.value;
      save("jc-settings", settings);
      speak("こんにちは、よろしくね");
    };
    $("btn-reset").onclick = () => {
      if (!confirm("Reset all your progress?")) return;
      progress = {};
      save("jc-progress", progress);
      renderHome();
    };

    // Home
    $("btn-start").onclick = () => {
      startSession([...shuffle(dueCards()), ...shuffle(newCards()).slice(0, settings.newPerSession)]);
    };
    $("btn-practice").onclick = () => {
      startSession(shuffle(window.DRILLS.filter(inSelectedCats)).slice(0, 10));
    };

    // Drill
    $("btn-quit").onclick = () => {
      if (recognizer) recognizer.abort();
      speechSynthesis.cancel();
      if (session.results.size) finish();
      else { session = null; show("home"); }
    };
    $("btn-say-q").onclick = () => speak(current().q);
    $("card-q-hidden").onclick = () => { $("card-q").hidden = false; $("card-q-hidden").hidden = true; };
    $("btn-mic").onclick = startListening;
    $("btn-type").onclick = () => {
      $("type-form").hidden = false;
      $("type-input").focus();
    };
    $("type-form").onsubmit = (e) => {
      e.preventDefault();
      const text = $("type-input").value.trim();
      if (text) grade([text]);
    };
    $("btn-say-a").onclick = () => speak(current().model);
    $("btn-meaning").onclick = () => setMeaning($("btn-meaning").getAttribute("aria-pressed") !== "true");
    $("btn-hint").onclick = () => setHint($("btn-hint").getAttribute("aria-pressed") !== "true");
    $("btn-retry").onclick = () => {
      $("btn-hint").hidden = false;
      setHint(false);
      $("result").hidden = true;
      $("listen-area").hidden = false;
      $("interim").textContent = "";
      $("mic-hint").textContent = "Tap and answer out loud";
      speechSynthesis.cancel();
    };
    $("btn-override").onclick = () => {
      session.attempt.verdict = "correct";
      session.attempt.overridden = true;
      $("btn-override").hidden = true;
      $("verdict").className = "verdict correct";
      $("verdict").textContent = "Marked correct";
    };
    $("btn-next").onclick = next;
    $("btn-home").onclick = () => show("home");

    show("home");

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  // Testing hook: simulate a recognition result for the current card.
  window.__simulateAnswer = (text) => session && grade(Array.isArray(text) ? text : [text]);

  init();
})();

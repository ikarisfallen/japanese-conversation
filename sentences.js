// Sentence patterns: casual Tokyo Japanese (タメ口) with interchangeable slots,
// so every round is a new combination you can't just memorize.
//
// A word is { jp, kana, en } plus optional extras:
//   say   what the voice should read (when the kanji is ambiguous, e.g. 何 → なに)
//   f     form flag the English sentence depends on (question / negative / …)
//
// A pattern's `parts` are built left to right. Each part is one of:
//   "、" / "？"                         punctuation (filled in automatically)
//   { pool: "color" }                   pick from a word pool; wrong choices come from the same pool
//   { pool: "adj", fits: (p) => [...] } only pick words that make sense with earlier picks
//   { word: w(...), alts: ["が", …] }   a fixed word with listed wrong choices (in kana)
//   { name: "x", … }                    names the pick so `en` can use it (defaults to the pool name)
// `en(p)` builds the English sentence from the picks. A sentence without final
// punctuation gets "？" if `endsWithQuestion(p)` says so, otherwise "。".
(function () {
  "use strict";

  const w = (jp, kana, en, extra = {}) => ({ jp, kana, en, ...extra });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const POOLS = {
    demo: [
      w("これ", "これ", "this"),
      w("それ", "それ", "that"),
      w("あれ", "あれ", "that (over there)"),
    ],
    kono: [
      w("この", "この", "this"),
      w("その", "その", "that"),
      w("あの", "あの", "that (over there)"),
    ],
    color: [
      w("赤い", "あかい", "red"),
      w("青い", "あおい", "blue"),
      w("白い", "しろい", "white"),
      w("黒い", "くろい", "black"),
      w("黄色い", "きいろい", "yellow"),
      w("茶色い", "ちゃいろい", "brown"),
    ],
    thing: [
      w("ボール", "ボール", "ball"),
      w("箱", "はこ", "box"),
      w("シャツ", "シャツ", "shirt"),
      w("かばん", "かばん", "bag"),
      w("傘", "かさ", "umbrella"),
      w("車", "くるま", "car"),
      w("帽子", "ぼうし", "hat"),
      w("ペン", "ペン", "pen"),
    ],
    owner: [
      w("私の", "わたしの", "my"),
      w("彼の", "かれの", "his"),
      w("彼女の", "かのじょの", "her"),
      w("友達の", "ともだちの", "my friend's"),
      w("先生の", "せんせいの", "the teacher's"),
      w("お兄ちゃんの", "おにいちゃんの", "my big brother's"),
    ],
    isEnding: [
      w("だよ", "だよ", "is (!)", { f: "yes" }),
      w("じゃないよ", "じゃないよ", "isn't", { f: "no" }),
      w("なの", "なの", "(is it?)", { f: "q" }),
    ],
    when: [
      w("今日", "きょう", "today"),
      w("明日", "あした", "tomorrow"),
      w("週末", "しゅうまつ", "this weekend"),
      w("今夜", "こんや", "tonight"),
    ],
    wantVerb: [
      w("食べたい", "たべたい", "want to eat", { v: "eat" }),
      w("飲みたい", "のみたい", "want to drink", { v: "drink" }),
      w("見たい", "みたい", "want to watch", { v: "watch" }),
      w("買いたい", "かいたい", "want to buy", { v: "buy" }),
      w("したい", "したい", "want to do", { v: "do" }),
    ],
    food: [
      w("ラーメン", "ラーメン", "ramen"),
      w("寿司", "すし", "sushi"),
      w("カレー", "カレー", "curry"),
      w("ピザ", "ピザ", "pizza"),
      w("うどん", "うどん", "udon"),
      w("焼き肉", "やきにく", "yakiniku"),
    ],
    drink: [
      w("コーヒー", "コーヒー", "coffee"),
      w("お茶", "おちゃ", "green tea"),
      w("水", "みず", "water"),
      w("ビール", "ビール", "beer"),
      w("ジュース", "ジュース", "juice"),
      w("牛乳", "ぎゅうにゅう", "milk"),
    ],
    item: [
      w("傘", "かさ", "umbrella"),
      w("鍵", "かぎ", "key"),
      w("スマホ", "スマホ", "phone"),
      w("財布", "さいふ", "wallet"),
      w("リモコン", "リモコン", "remote"),
    ],
    location: [
      w("机の上", "つくえのうえ", "on the desk"),
      w("椅子の下", "いすのした", "under the chair"),
      w("かばんの中", "かばんのなか", "in the bag"),
      w("ドアの横", "ドアのよこ", "next to the door"),
      w("テレビの前", "テレビのまえ", "in front of the TV"),
    ],
    existEnding: [
      w("あるよ", "あるよ", "is there (!)", { f: "yes" }),
      w("ある", "ある", "is there?", { f: "q" }),
      w("ないよ", "ないよ", "isn't there", { f: "no" }),
    ],
    dest: [
      w("渋谷", "しぶや", "Shibuya"),
      w("新宿", "しんじゅく", "Shinjuku"),
      w("学校", "がっこう", "school"),
      w("会社", "かいしゃ", "work"),
      w("コンビニ", "コンビニ", "the konbini"),
      w("公園", "こうえん", "the park"),
      w("駅", "えき", "the station"),
    ],
    goEnding: [
      w("行く", "いく", "going?", { f: "q" }),
      w("行くよ", "いくよ", "going (!)", { f: "yes" }),
      w("行かない", "いかない", "not going", { f: "no" }),
    ],
    likeable: [
      w("猫", "ねこ", "cats"),
      w("犬", "いぬ", "dogs"),
      w("野菜", "やさい", "vegetables"),
      w("魚", "さかな", "fish"),
      w("夏", "なつ", "summer"),
      w("冬", "ふゆ", "winter"),
      w("映画", "えいが", "movies"),
      w("カラオケ", "カラオケ", "karaoke"),
    ],
    likeEnding: [
      w("好き", "すき", "like?", { f: "q" }),
      w("好きだよ", "すきだよ", "like (!)", { f: "yes" }),
      w("あんまり好きじゃない", "あんまりすきじゃない", "don't really like", { f: "no" }),
    ],
    fruit: [
      w("りんご", "りんご", "apple", { pl: "apples" }),
      w("みかん", "みかん", "mandarin", { pl: "mandarins" }),
      w("おにぎり", "おにぎり", "rice ball", { pl: "rice balls" }),
      w("卵", "たまご", "egg", { pl: "eggs" }),
    ],
    count: [
      w("一つ", "ひとつ", "one", { n: 1 }),
      w("二つ", "ふたつ", "two", { n: 2 }),
      w("三つ", "みっつ", "three", { n: 3 }),
      w("四つ", "よっつ", "four", { n: 4 }),
      w("五つ", "いつつ", "five", { n: 5 }),
    ],
    countEnding: [
      w("ちょうだい", "ちょうだい", "give me", { f: "give" }),
      w("ある", "ある", "do you have?", { f: "q" }),
      w("買った", "かった", "bought", { f: "bought" }),
    ],
    spot: [
      w("部屋", "へや", "room", { adjs: ["big", "cramped", "new", "old"] }),
      w("店", "みせ", "shop", { adjs: ["big", "cramped", "new", "old", "expensive", "cheap"] }),
      w("公園", "こうえん", "park", { adjs: ["big", "cramped", "new", "old"] }),
      w("家", "いえ", "house", { adjs: ["big", "cramped", "new", "old", "expensive", "cheap"] }),
      w("車", "くるま", "car", { adjs: ["big", "cramped", "new", "old", "expensive", "cheap"] }),
    ],
    very: [
      w("すごく", "すごく", "really"),
      w("ちょっと", "ちょっと", "a bit"),
      w("めっちゃ", "めっちゃ", "super"),
      w("意外と", "いがいと", "surprisingly"),
    ],
    adj: [
      w("広い", "ひろい", "big"),
      w("狭い", "せまい", "cramped"),
      w("新しい", "あたらしい", "new"),
      w("古い", "ふるい", "old"),
      w("高い", "たかい", "expensive"),
      w("安い", "やすい", "cheap"),
    ],
  };

  const NANI = w("何", "なに", "what", { say: "なに" });

  window.CATEGORIES = {
    things: "これ・あれ",
    wants: "したいこと",
    places: "どこ・行く",
    likes: "好き・きらい",
    shopping: "買い物・数",
    describe: "様子",
  };

  window.PATTERNS = [
    {
      id: "this-color-thing", cat: "things",
      parts: [{ pool: "demo" }, "、", { pool: "color" }, { pool: "thing" }, { pool: "isEnding" }],
      en: (p) => {
        const x = `a ${p.color.en} ${p.thing.en}`;
        return p.isEnding.f === "q" ? `Is ${p.demo.en} ${x}?`
          : `${cap(p.demo.en)} ${p.isEnding.f === "no" ? "isn't" : "is"} ${x}.`;
      },
      endsWithQuestion: (p) => p.isEnding.f === "q",
    },
    {
      id: "this-owner-thing", cat: "things",
      parts: [{ pool: "demo" }, "、", { pool: "owner" }, { pool: "thing" }, { pool: "isEnding" }],
      en: (p) => {
        const x = `${p.owner.en} ${p.thing.en}`;
        return p.isEnding.f === "q" ? `Is ${p.demo.en} ${x}?`
          : `${cap(p.demo.en)} ${p.isEnding.f === "no" ? "isn't" : "is"} ${x}.`;
      },
      endsWithQuestion: (p) => p.isEnding.f === "q",
    },
    {
      id: "what-want", cat: "wants",
      parts: [
        { pool: "when" }, "、",
        { word: NANI, alts: ["どこ", "だれ", "いつ"] },
        { pool: "wantVerb" }, "？",
      ],
      en: (p) => `What do you want to ${p.wantVerb.v} ${p.when.en}?`,
    },
    {
      id: "want-food", cat: "wants",
      parts: [
        { pool: "when" },
        { word: w("は", "は", "(as for)"), alts: ["を", "に"] },
        { pool: "food" },
        { word: w("が", "が", "(subject)"), alts: ["で", "に"] },
        { word: w("食べたい", "たべたい", "want to eat"), alts: ["のみたい", "みたい"] },
        { word: w("な", "な", "(I feel like)"), alts: ["よ", "の"] },
      ],
      en: (p) => `I feel like eating ${p.food.en} ${p.when.en}.`,
    },
    {
      id: "want-drink", cat: "wants",
      parts: [
        { pool: "when" },
        { word: w("は", "は", "(as for)"), alts: ["を", "に"] },
        { pool: "drink" },
        { word: w("が", "が", "(subject)"), alts: ["で", "に"] },
        { word: w("飲みたい", "のみたい", "want to drink"), alts: ["たべたい", "かいたい"] },
        { word: w("な", "な", "(I feel like)"), alts: ["よ", "の"] },
      ],
      en: (p) => `I feel like drinking ${p.drink.en} ${p.when.en}.`,
    },
    {
      id: "where-is-item", cat: "places",
      parts: [
        { pool: "item" }, "、", { pool: "location" },
        { word: w("に", "に", "(at)"), alts: ["を", "が"] },
        { pool: "existEnding" },
      ],
      en: (p) => {
        const f = p.existEnding.f;
        return f === "q" ? `Is the ${p.item.en} ${p.location.en}?`
          : `The ${p.item.en} ${f === "no" ? "isn't" : "is"} ${p.location.en}.`;
      },
      endsWithQuestion: (p) => p.existEnding.f === "q",
    },
    {
      id: "going-to", cat: "places",
      parts: [{ pool: "when" }, "、", { pool: "dest" }, { pool: "goEnding" }],
      en: (p) => {
        const f = p.goEnding.f;
        const where = `to ${p.dest.en} ${p.when.en}`;
        return f === "q" ? `Are you going ${where}?`
          : f === "no" ? `I'm not going ${where}.` : `I'm going ${where}.`;
      },
      endsWithQuestion: (p) => p.goEnding.f === "q",
    },
    {
      id: "do-you-like", cat: "likes",
      parts: [{ pool: "likeable" }, "、", { pool: "likeEnding" }],
      en: (p) => {
        const f = p.likeEnding.f;
        return f === "q" ? `Do you like ${p.likeable.en}?`
          : f === "no" ? `I don't really like ${p.likeable.en}.` : `I like ${p.likeable.en}.`;
      },
      endsWithQuestion: (p) => p.likeEnding.f === "q",
    },
    {
      id: "counting", cat: "shopping",
      parts: [{ pool: "fruit" }, "、", { pool: "count" }, { pool: "countEnding" }],
      en: (p) => {
        const x = `${p.count.en} ${p.count.n === 1 ? p.fruit.en : p.fruit.pl}`;
        const f = p.countEnding.f;
        return f === "q" ? `Do you have ${x}?` : f === "bought" ? `I bought ${x}.` : `Give me ${x}.`;
      },
      endsWithQuestion: (p) => p.countEnding.f === "q",
    },
    {
      id: "describe-place", cat: "describe",
      parts: [
        { pool: "kono" }, { pool: "spot" }, "、", { pool: "very" },
        { pool: "adj", fits: (p) => POOLS.adj.filter((a) => p.spot.adjs.includes(a.en)) },
        { word: w("ね", "ね", "(huh)"), alts: ["よ", "か"] },
      ],
      en: (p) => `${cap(p.kono.en)} ${p.spot.en} is ${p.very.en} ${p.adj.en}, huh.`,
    },
  ];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Wrong choices: other words from the same pool (different kana), up to `n`.
  function distractors(correct, candidates, n) {
    const seen = new Set([correct.kana]);
    const out = [];
    for (const c of shuffle(candidates)) {
      const k = typeof c === "string" ? c : c.kana;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
      if (out.length === n) break;
    }
    return out;
  }

  // Returns { pattern, words: [{jp, kana, en, say?, choices?} | {punct}], jp, kana, say, en }.
  function generate(pattern) {
    const p = {};
    const words = [];
    for (const part of pattern.parts) {
      if (typeof part === "string") { words.push({ punct: part }); continue; }
      let word, wrong;
      if (part.word) {
        word = part.word;
        wrong = distractors(word, part.alts, 3);
      } else {
        const pool = POOLS[part.pool];
        word = pick(part.fits ? part.fits(p) : pool);
        wrong = distractors(word, pool, 3);
      }
      p[part.name || part.pool || word.kana] = word;
      words.push({ ...word, choices: shuffle([word.kana, ...wrong]) });
    }
    if (!words[words.length - 1].punct) {
      const question = pattern.endsWithQuestion && pattern.endsWithQuestion(p);
      words.push({ punct: question ? "？" : "。" });
    }
    const text = (key) => words.map((x) => x.punct || x[key] || x.jp).join("");
    return {
      pattern,
      words,
      jp: text("jp"),
      kana: words.map((x) => x.punct || x.kana).join(""),
      say: text("say"),
      en: pattern.en(p),
    };
  }

  window.Sentences = { POOLS, generate, shuffle };
})();

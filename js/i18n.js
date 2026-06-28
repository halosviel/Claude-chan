// ===========================================================================
//  i18n.js
//
//  Tiny localization layer. Static elements carry a data-i18n="key" and are
//  filled from the dictionary; dynamic strings (placeholders, speaker, the
//  transcript labels, the voice hint) call t(key) and re-apply via onChange.
//  Switching language updates everything that is English by default; Japanese
//  labels, symbols, the date, and filenames are left untouched (the Japanese
//  panel glosses are simply the English ones, hidden in Japanese mode).
//
//  Languages are listed by their own name (English / 日本語) in the Language
//  panel; the pick is remembered in localStorage.
// ===========================================================================

import { qs, qsa } from "./util/dom.js";
import { playSound } from "./util/sound.js";

const LANG_KEY = "claudechan.lang";

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
];

const DICT = {
  en: {
    "speaker.you": "you",
    "hint.talk": "Press \"/\" to talk",
    "hint.continue": "Click to continue",
    "placeholder.idle": "press  /  to chat",
    "placeholder.typing": "say something…",
    "win.terminal": "terminal",
    "win.memory": "Memory",
    "win.transcript": "Backlog",
    "win.help": "Help",
    "win.settings": "Settings",
    "win.permission": "Permission needed",
    "btn.view": "View",
    "btn.open": "Open",
    "btn.start": "start",
    "help.chat": "Press <kbd>/</kbd> to chat with Claude-chan",
    "help.cancel": "Press <kbd>Esc</kbd> to cancel prompt",
    "help.next": "Press <kbd>Space</kbd> / <kbd>→</kbd> or click to go forward",
    "help.prev": "Press <kbd>←</kbd> or right-click to go back",
    "memory.heading": "Memory",
    "memory.intro": "Claude-chan's memories live here.<br>If you want to alter Claude-chan's memories, simply tell her!",
    "transcript.start": "Session started",
    "transcript.you": "You",
    "transcript.claude": "Claude-chan",
    "shutdown": "It's now safe to turn off Claude-chan.",
    "perm.yes": "Yes",
    "perm.no": "No",
    "voice.note": "🔇 the AivisSpeech engine isn't running — start it, then reload (see README).",
  },
  ja: {
    "speaker.you": "あなた",
    "hint.talk": "「/」キーで話す",
    "hint.continue": "クリックで続行",
    "placeholder.idle": "「/」キーでチャット",
    "placeholder.typing": "なにか話しかけて…",
    "win.terminal": "ターミナル",
    "win.memory": "メモリー",
    "win.transcript": "記録",
    "win.help": "ヘルプ",
    "win.settings": "設定",
    "win.permission": "許可が必要です",
    "btn.view": "見る",
    "btn.open": "開く",
    "btn.start": "スタート",
    "help.chat": "<kbd>/</kbd> キーで Claude-chan と話す",
    "help.cancel": "<kbd>Esc</kbd> キーでキャンセル",
    "help.next": "<kbd>Space</kbd> / <kbd>→</kbd> またはクリックで進む",
    "help.prev": "<kbd>←</kbd> または右クリックで戻る",
    "memory.heading": "メモリー",
    "memory.intro": "Claude-chan の記憶はここに。<br>記憶を変えたいときは、彼女に話しかけてね！",
    "transcript.start": "セッション開始",
    "transcript.you": "あなた",
    "transcript.claude": "Claude-chan",
    "shutdown": "Claude-chan を終了しても安全です。",
    "perm.yes": "はい",
    "perm.no": "いいえ",
    "voice.note": "🔇 AivisSpeech エンジンが起動していません。起動して再読み込みしてください。",
  },
};

// Read/persist the language preference, tolerating storage being unavailable.
function readStoredLang() {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch (error) {
    return null;
  }
}

function storeLang(value) {
  try {
    localStorage.setItem(LANG_KEY, value);
  } catch (error) {
    // storage unavailable (private mode); language just won't persist
  }
}

// Active language and the listeners notified when it changes.
let lang = readStoredLang() || "en";
const listeners = [];

//
// Translate a key into the active language (falling back to English, then the
// key itself).
//
export function t(key) {
  const table = DICT[lang] || DICT.en;

  if (table[key] != null) {
    return table[key];
  }

  return DICT.en[key] != null ? DICT.en[key] : key;
}

//
// The active language id.
//
export function getLang() {
  return lang;
}

//
// Register a callback run whenever the language changes (and dynamic strings
// need re-applying).
//
export function onChange(callback) {
  listeners.push(callback);
}

//
// Fill every [data-i18n] element and flag the body so Japanese-mode CSS can hide
// the (now-redundant) English glosses.
//
function applyStatic() {
  qsa("[data-i18n]").forEach((element) => {
    element.innerHTML = t(element.dataset.i18n);
  });

  document.body.classList.toggle("lang-ja", lang === "ja");
}

//
// Highlight the active language in the picker list.
//
function highlight(list) {
  list.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.id === lang);
  });
}

//
// Switch language: persist it, re-apply static text, and notify listeners.
//
export function setLang(next) {
  if (!DICT[next]) {
    return;
  }

  lang = next;
  storeLang(lang);
  applyStatic();
  listeners.forEach((callback) => callback(lang));
}

//
// Build the language picker, apply the saved language, and wire switching.
// Called once at startup (before the dynamic modules register, so they get the
// initial language from getLang()).
//
export function initI18n() {
  const list = qs("#language-list");

  if (list) {
    list.innerHTML = "";

    LANGUAGES.forEach((language) => {
      const item = document.createElement("li");
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = language.label;
      button.dataset.id = language.id;
      button.addEventListener("click", () => {
        playSound("click");
        setLang(language.id);
        highlight(list);
      });

      item.appendChild(button);
      list.appendChild(item);
    });

    highlight(list);
  }

  applyStatic();
}

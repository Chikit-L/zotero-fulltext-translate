import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { TranslationControl } from "./TranslationControl";

const prefKeys = [
  "mineruToken",
  "mineruModelVersion",
  "mineruLanguage",
  "mineruEnableOCR",
  "mineruEnableTable",
  "mineruEnableFormula",
] as const;

type PrefKey = (typeof prefKeys)[number];

type PrefElement = Element & {
  value?: string;
  checked?: boolean;
  dataset: DOMStringMap;
  addEventListener: typeof Element.prototype.addEventListener;
  setAttribute: typeof Element.prototype.setAttribute;
  removeAttribute: typeof Element.prototype.removeAttribute;
  getAttribute: typeof Element.prototype.getAttribute;
  localName: string;
};

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
    };
  } else {
    addon.data.prefs.window = _window;
  }
  updatePrefsUI();
  bindPrefEvents();
}

async function updatePrefsUI() {
  if (addon.data.prefs?.window == undefined) return;
  const doc = addon.data.prefs.window.document;
  const values: Record<PrefKey, string | boolean> = {
    mineruToken: String(getPref("mineruToken") || ""),
    mineruModelVersion: String(getPref("mineruModelVersion") || "vlm"),
    mineruLanguage: String(getPref("mineruLanguage") || "en"),
    mineruEnableOCR: Boolean(getPref("mineruEnableOCR")),
    mineruEnableTable: getPref("mineruEnableTable") !== false,
    mineruEnableFormula: getPref("mineruEnableFormula") !== false,
  };

  for (const key of prefKeys) {
    const value = values[key];
    const el = getPrefElement(doc, key);
    if (!el) continue;
    if (isCheckboxElement(el)) {
      el.checked = Boolean(value);
      if (Boolean(value)) {
        el.setAttribute("checked", "true");
      } else {
        el.removeAttribute("checked");
      }
      continue;
    }
    if (typeof el.value !== "undefined") {
      el.value = String(value);
    }
  }
}

function bindPrefEvents() {
  const doc = addon.data.prefs!.window.document;

  for (const key of prefKeys) {
    const el = getPrefElement(doc, key);
    if (!el || el.dataset.bound === "true") continue;
    el.dataset.bound = "true";

    const save = () => savePrefValue(key, el);

    el.addEventListener("change", save);
    if (!isCheckboxElement(el) && typeof el.value !== "undefined") {
      el.addEventListener("input", save);
      el.addEventListener("blur", save);
    }
    if (isCheckboxElement(el)) {
      el.addEventListener("command", save as EventListener);
      el.addEventListener("click", save as EventListener);
    }
  }

  const saveButton = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-savePrefs`,
  ) as PrefElement | null;
  if (saveButton && saveButton.dataset.bound !== "true") {
    saveButton.dataset.bound = "true";
    saveButton.addEventListener("click", () => {
      saveAllPrefs(doc);
      Zotero.alert(
        addon.data.prefs!.window,
        addon.data.config.addonName,
        getString("pref-save-success"),
      );
    });
  }

  const apiButton = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-openMineruApi`,
  ) as PrefElement | null;
  if (apiButton && apiButton.dataset.bound !== "true") {
    apiButton.dataset.bound = "true";
    apiButton.addEventListener("click", () => {
      Zotero.launchURL("https://mineru.net/apiManage/token");
    });
  }

  const stopButton = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-stopAllTranslations`,
  ) as PrefElement | null;
  if (stopButton && stopButton.dataset.bound !== "true") {
    stopButton.dataset.bound = "true";
    stopButton.addEventListener("click", () => {
      TranslationControl.requestStopAll();
      Zotero.alert(
        addon.data.prefs!.window,
        addon.data.config.addonName,
        getString("pref-stop-all-success" as any),
      );
    });
  }
}

function saveAllPrefs(doc: Document) {
  for (const key of prefKeys) {
    const el = getPrefElement(doc, key);
    if (!el) continue;
    savePrefValue(key, el);
  }
}

function savePrefValue(key: PrefKey, el: PrefElement) {
  if (isCheckboxElement(el)) {
    setPref(key, Boolean(el.checked) as never);
    if (el.checked) {
      el.setAttribute("checked", "true");
    } else {
      el.removeAttribute("checked");
    }
    return;
  }
  if (typeof el.value !== "undefined") {
    setPref(key, el.value as never);
  }
}

function getPrefElement(doc: Document, key: PrefKey) {
  return doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-${key}`,
  ) as PrefElement | null;
}

function isCheckboxElement(el: PrefElement) {
  return (
    el.localName.toLowerCase() === "checkbox" ||
    el.getAttribute("type") === "checkbox"
  );
}

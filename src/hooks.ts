import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { Common } from "./modules/Common";

const initializedWindows = new Set<_ZoteroTypes.MainWindow>();

async function onStartup() {
  initLocale();

  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  Common.registerRightClickMenuItem();

  addon.data.initialized = true;

  // Window decoration should not block plugin startup or menu availability.
  void Promise.allSettled(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  if (initializedWindows.has(win)) {
    return;
  }
  initializedWindows.add(win);

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
}

async function onMainWindowUnload(win: Window): Promise<void> {
  initializedWindows.delete(win as _ZoteroTypes.MainWindow);
  win.document
    .querySelector(`[href="${addon.data.config.addonRef}-mainWindow.ftl"]`)
    ?.remove();
}

function onShutdown(): void {
  initializedWindows.clear();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};

import { config } from "../../package.json";
import { getString } from "../utils/locale";

let menuRegistered = false;

export class Common {
  static registerRightClickMenuItem() {
    if (menuRegistered) {
      return;
    }
    const menuIcon = `chrome://${config.addonRef}/content/icons/fulltexttranslate.svg`;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: `${config.addonRef}-translate-fulltext`,
      label: getString("menuitem-translate-fulltext"),
      icon: menuIcon,
      isHidden: () => {
        const items = Zotero.getActiveZoteroPane().getSelectedItems();
        return !items.some((item) => item.isRegularItem());
      },
      commandListener: () => {
        const items = Zotero.getActiveZoteroPane().getSelectedItems();
        void import("./TranslationWorkflow").then(({ TranslationWorkflow }) =>
          TranslationWorkflow.translateSelectedItems(items),
        );
      },
    });
    menuRegistered = true;
  }
}

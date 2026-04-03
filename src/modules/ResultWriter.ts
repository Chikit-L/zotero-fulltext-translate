import type { TranslatedStructuredBlock } from "./TranslationAdapter";
import { HTMLRenderer } from "./HTMLRenderer";
import { TranslationControl } from "./TranslationControl";

export class ResultWriter {
  static async attachHTMLResult(
    item: Zotero.Item,
    title: string,
    originalMarkdown: string,
    translatedMarkdown: string,
  ) {
    const html = HTMLRenderer.render(title, originalMarkdown, translatedMarkdown);
    return this.attachHTML(item, title, html);
  }

  static async attachStructuredHTMLResult(
    item: Zotero.Item,
    title: string,
    blocks: TranslatedStructuredBlock[],
  ) {
    const html = HTMLRenderer.renderStructured(title, blocks);
    return this.attachHTML(item, title, html);
  }

  private static async attachHTML(item: Zotero.Item, title: string, html: string) {
    TranslationControl.throwIfStopped();
    const tmpDir = Zotero.getTempDirectory().path;
    await Zotero.File.createDirectoryIfMissingAsync(tmpDir);
    const safeName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "translation";
    const path = PathUtils.join(tmpDir, `${safeName}.translated.html`);
    await Zotero.File.putContentsAsync(path, html, "utf-8");

    const attachment = await Zotero.Attachments.importFromFile({
      file: path,
      parentItemID: item.id,
      title: `${title} - Full Text Translation`,
      contentType: "text/html",
    });

    return attachment;
  }
}

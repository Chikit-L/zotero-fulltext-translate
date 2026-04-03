import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { MineruClient } from "./MineruClient";
import { ResultWriter } from "./ResultWriter";
import { TranslationAdapter } from "./TranslationAdapter";
import { TranslationControl } from "./TranslationControl";

export class TranslationWorkflow {
  static async translateSelectedItems(items: Zotero.Item[]) {
    TranslationControl.beginRun();
    const regularItems = items.filter((item) => item.isRegularItem());
    if (!regularItems.length) {
      this.show(getString("error-no-regular-item"), "fail");
      return;
    }

    for (const item of regularItems) {
      TranslationControl.throwIfStopped();
      await this.translateItem(item);
    }
  }

  private static async translateItem(item: Zotero.Item) {
    const isLightweightMode = !String(getPref("mineruToken") || "").trim();
    const progress = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    });

    if (isLightweightMode) {
      progress.createLine({
        text: "当前使用轻量解析 API，无法解析图片表格，并有解析限制，强烈建议在设置中填写 MinerU API。",
        type: "default",
        progress: 100,
        idx: 0,
      });
      progress.createLine({
        text: `${getString("progress-start")} ${item.getDisplayTitle()}`,
        progress: 5,
        idx: 1,
      });
    } else {
      progress.createLine({
        text: `${getString("progress-start")} ${item.getDisplayTitle()}`,
        progress: 5,
        idx: 0,
      });
    }

    progress.show();
    const progressUpdater = (text: string, type?: "success" | "fail" | "default") =>
      this.updateStatusLine(progress, 100, text, isLightweightMode, type);
    TranslationControl.registerProgress(progressUpdater);

    try {
      TranslationControl.throwIfStopped();
      const attachmentInfo = await this.getLocalPDFAttachment(item);
      if (!attachmentInfo) {
        throw new Error(getString("error-no-pdf"));
      }

      const { attachment, filePath } = attachmentInfo;
      if (!filePath) {
        throw new Error(getString("error-pdf-not-local"));
      }

      ztoolkit.log("[Full Text Translate] Selected PDF attachment", {
        title: attachment.getDisplayTitle(),
        fileName: attachment.attachmentFilename,
        linkMode: attachment.attachmentLinkMode,
        path: filePath,
      });

      this.updateStatusLine(progress, 15, "已定位本地 PDF 附件，准备提交到 MinerU", isLightweightMode);

      TranslationControl.throwIfStopped();
      this.updateStatusLine(progress, 30, getString("progress-mineru"), isLightweightMode);
      const parseResult = await MineruClient.parsePDF(
        filePath,
        attachment.attachmentFilename || `${attachment.key}.pdf`,
      );

      this.updateStatusLine(
        progress,
        55,
        "MinerU 解析完成，准备按 Markdown 逐段翻译正文",
        isLightweightMode,
      );

      TranslationControl.throwIfStopped();
      const translation = await TranslationAdapter.translateMarkdown(
        parseResult.markdown,
        item.id,
        (translationProgress) => {
          const total = Math.max(translationProgress.total, 1);
          const current = Math.min(translationProgress.current, total);
          const base = 55;
          const span = 30;
          const computed =
            translationProgress.stage === "done"
              ? base + span
              : base + Math.floor((current / total) * span);
          let text = `正在翻译正文 ${current}/${total}`;
          if (translationProgress.stage === "retrying") {
            text += `，重试第 ${translationProgress.retries} 次`;
          }
          this.updateStatusLine(progress, computed, text, isLightweightMode);
        },
      );

      TranslationControl.throwIfStopped();
      this.updateStatusLine(progress, 90, getString("progress-output"), isLightweightMode);
      const resultAttachment = await ResultWriter.attachHTMLResult(
        item,
        item.getDisplayTitle(),
        parseResult.markdown,
        translation.translatedMarkdown,
        translation.sourceBlocks,
        translation.translatedBlocks,
        parseResult.markdownImageMap,
      );

      this.updateStatusLine(
        progress,
        100,
        `${getString("progress-done")} ${resultAttachment.getDisplayTitle()}`,
        isLightweightMode,
        "success",
      );
      progress.startCloseTimer(4000);
    } catch (error) {
      if (TranslationControl.isStopError(error)) {
        this.updateStatusLine(progress, 100, "已停止当前全文翻译任务。", isLightweightMode, "default");
        progress.startCloseTimer(4000);
      } else {
        const message = this.formatErrorMessage(error);
        this.updateStatusLine(progress, 100, message, isLightweightMode, "fail");
        progress.startCloseTimer(8000);
        ztoolkit.log(`[Full Text Translate] Workflow error: ${message}`);
        if (error instanceof Error && error.stack) {
          ztoolkit.log(error.stack);
        } else {
          ztoolkit.log(error);
        }
      }
    } finally {
      TranslationControl.unregisterProgress(progressUpdater);
    }
  }

  private static async getLocalPDFAttachment(item: Zotero.Item) {
    const attachmentIDs = item.getAttachments();
    if (!attachmentIDs.length) {
      return null;
    }

    const attachments = (Zotero.Items.get(attachmentIDs) as Zotero.Item[])
      .filter((attachment) => attachment?.isAttachment() && attachment.isPDFAttachment())
      .sort((a, b) => this.scorePDFAttachment(a) - this.scorePDFAttachment(b));

    for (const attachment of attachments) {
      const filePath = await attachment.getFilePathAsync();
      if (!filePath) {
        continue;
      }
      return { attachment, filePath };
    }

    return null;
  }

  private static scorePDFAttachment(attachment: Zotero.Item) {
    if (attachment.isStoredFileAttachment() || attachment.isImportedAttachment()) {
      return 0;
    }
    if (attachment.isLinkedFileAttachment()) {
      return 1;
    }
    return 2;
  }

  private static updateStatusLine(
    progress: any,
    value: number,
    text: string,
    isLightweightMode: boolean,
    type?: "success" | "fail" | "default",
  ) {
    progress.changeLine({
      idx: isLightweightMode ? 1 : 0,
      progress: value,
      text,
      type,
    });
  }

  private static formatErrorMessage(error: unknown) {
    const rawMessage = this.extractErrorMessage(error);
    if (!rawMessage) {
      return getString("error-unknown");
    }

    const httpMessage = this.formatHTTPErrorMessage(rawMessage);
    if (httpMessage) {
      return httpMessage;
    }

    if (/MinerU polling timed out/i.test(rawMessage)) {
      return "MinerU 解析等待超时。任务可能仍在服务器处理中，请稍后重试。";
    }

    if (/Translation failed after retry/i.test(rawMessage)) {
      return "翻译服务连续重试后仍然失败。请检查 Translate for Zotero 当前使用的翻译引擎是否可用，并确认字符额度和请求速率限制充足。";
    }

    return rawMessage;
  }

  private static formatHTTPErrorMessage(message: string) {
    const match = message.match(/HTTP\s+(GET|POST|PUT|DELETE)\s+(\S+)\s+failed with status code\s+(\d{3})/i);
    if (!match) {
      return "";
    }

    const [, method, url, statusText] = match;
    const status = Number(statusText);
    const isMineru = /mineru\.net|cdn-mineru|mineru\.oss/i.test(url);
    const isTranslate = /translate/i.test(url);

    if (isMineru) {
      if (status === 401) {
        return "MinerU API 认证失败（401）。请检查设置中的 API Token 是否填写正确、是否已经过期，以及前面是否没有多余字符。";
      }
      if (status === 403) {
        return method.toUpperCase() === "PUT"
          ? "MinerU 文件上传被拒绝（403）。通常是上传签名已失效或签名校验失败，请稍后重试。"
          : "MinerU 请求被拒绝（403）。请检查 Token 权限，或稍后重试。";
      }
      if (status === 404) {
        return "MinerU 接口地址不可用（404）。请确认当前使用的是受支持的 API，并稍后重试。";
      }
      if (status === 408 || status === 504) {
        return "MinerU 请求超时。可能是文件较大或服务响应较慢，请稍后重试。";
      }
      if (status === 429) {
        return "MinerU 请求过于频繁（429）。请稍等一段时间后再试。";
      }
      if (status >= 500) {
        return `MinerU 服务暂时不可用（${status}）。这通常是服务器侧异常，请稍后重试。`;
      }
      return `MinerU 请求失败（${status}）。请检查设置并稍后重试。`;
    }

    if (isTranslate) {
      if (status === 401 || status === 403) {
        return `翻译服务认证失败（${status}）。请检查 Translate for Zotero 当前使用引擎的密钥或权限设置。`;
      }
      if (status === 429) {
        return "翻译服务请求过于频繁（429）。请稍后重试，或在 Translate for Zotero 中切换到额度更充足的引擎。";
      }
      if (status >= 500) {
        return `翻译服务暂时不可用（${status}）。请稍后重试，或在 Translate for Zotero 中切换其他引擎。`;
      }
      return `翻译服务请求失败（${status}）。请检查 Translate for Zotero 当前使用的引擎配置。`;
    }

    return `网络请求失败（${status}）。请稍后重试。`;
  }

  private static extractErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === "string" && error) {
      return error;
    }
    if (error && typeof error === "object") {
      const maybeMessage = Reflect.get(error, "message");
      if (typeof maybeMessage === "string" && maybeMessage) {
        return maybeMessage;
      }
      try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}") {
          return serialized;
        }
      } catch {
        // ignore JSON serialization failures
      }
    }
    return "";
  }

  private static show(text: string, type: "success" | "fail" | "default") {
    new ztoolkit.ProgressWindow(addon.data.config.addonName)
      .createLine({
        text,
        type,
        progress: 100,
      })
      .show();
  }
}

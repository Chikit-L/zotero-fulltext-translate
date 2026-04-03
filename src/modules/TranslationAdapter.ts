import type { MineruStructuredBlock } from "./MineruClient";
import {
  prepareMathForTranslation,
  restoreProtectedMathSegments,
} from "./MathProcessor";
import { TranslationControl } from "./TranslationControl";

type TranslationResult = {
  translatedMarkdown: string;
  sourceBlocks: string[];
  translatedBlocks: string[];
  provider: string;
};

export type TranslatedStructuredBlock =
  | {
      type: "text";
      originalText: string;
      translatedText: string;
      level?: number;
    }
  | {
      type: "table";
      originalCaption?: string;
      translatedCaption?: string;
      originalHtml: string;
      translatedHtml: string;
    }
  | {
      type: "image";
      originalCaption?: string;
      translatedCaption?: string;
      dataUrl?: string;
    };

type StructuredTranslationResult = {
  blocks: TranslatedStructuredBlock[];
  provider: string;
};

type TranslationProgress = {
  current: number;
  total: number;
  stage: "preparing" | "translating" | "retrying" | "done";
  retries?: number;
};

type MarkdownBlock = {
  raw: string;
  translatable: boolean;
  isReferenceHeading: boolean;
};

type PreparedStructuredBlock = MineruStructuredBlock;

export class TranslationAdapter {
  static async translateMarkdown(
    markdown: string,
    itemID?: number,
    onProgress?: (progress: TranslationProgress) => void,
  ): Promise<TranslationResult> {
    const pdfTranslate = this.getPDFTranslateAPI();
    const blocks = this.splitBlocks(markdown);
    onProgress?.({
      current: 0,
      total: blocks.length,
      stage: "preparing",
    });

    const translatedBlocks = blocks.map((block) => block.raw);
    let skipRemainingTranslation = false;

    for (let index = 0; index < blocks.length; index++) {
      TranslationControl.throwIfStopped();
      const block = blocks[index];
      if (block.isReferenceHeading) {
        skipRemainingTranslation = true;
      }
      if (skipRemainingTranslation) {
        translatedBlocks[index] = block.raw;
        continue;
      }
      if (this.isHTMLTableBlock(block.raw)) {
        translatedBlocks[index] = await this.translateTableHTML(
          pdfTranslate,
          block.raw,
          itemID,
          () => ({ current: index + 1, total: blocks.length }),
          onProgress,
        );
        continue;
      }
      if (!block.translatable) {
        translatedBlocks[index] = block.raw;
        continue;
      }
      translatedBlocks[index] = await this.translateChunkWithRetry(
        pdfTranslate,
        block.raw,
        itemID,
        index + 1,
        blocks.length,
        onProgress,
      );
    }

    onProgress?.({ current: blocks.length, total: blocks.length, stage: "done" });

    return {
      translatedMarkdown: translatedBlocks.join("\n\n"),
      sourceBlocks: blocks.map((block) => block.raw),
      translatedBlocks,
      provider: "PDFTranslate.current",
    };
  }

  static async translateStructuredBlocks(
    blocks: MineruStructuredBlock[],
    markdown: string,
    itemID?: number,
    onProgress?: (progress: TranslationProgress) => void,
  ): Promise<StructuredTranslationResult> {
    const pdfTranslate = this.getPDFTranslateAPI();
    const preparedBlocks = this.prepareStructuredBlocks(blocks, markdown);
    const total = this.countTranslatableUnits(preparedBlocks);
    onProgress?.({
      current: 0,
      total,
      stage: "preparing",
    });

    const translatedBlocks: TranslatedStructuredBlock[] = [];
    let completed = 0;
    let skipRemainingTranslation = false;

    for (const block of preparedBlocks) {
      TranslationControl.throwIfStopped();
      if (block.type === "table") {
        const translatedCaption = block.caption
          ? await this.translateAuxiliaryText(
              pdfTranslate,
              block.caption,
              itemID,
              ++completed,
              total,
              onProgress,
            )
          : undefined;
        const translatedHtml = await this.translateTableHTML(
          pdfTranslate,
          block.html,
          itemID,
          () => ({ current: ++completed, total }),
          onProgress,
        );
        translatedBlocks.push({
          type: "table",
          originalCaption: block.caption,
          translatedCaption,
          originalHtml: block.html,
          translatedHtml,
        });
        continue;
      }

      if (block.type === "image") {
        const translatedCaption = block.caption
          ? await this.translateAuxiliaryText(
              pdfTranslate,
              block.caption,
              itemID,
              ++completed,
              total,
              onProgress,
            )
          : undefined;
        translatedBlocks.push({
          type: "image",
          originalCaption: block.caption,
          translatedCaption,
          dataUrl: block.dataUrl,
        });
        continue;
      }

      if (this.isReferenceSection(block.text)) {
        skipRemainingTranslation = true;
      }

      let translatedText = block.text;
      if (!skipRemainingTranslation && block.text.trim()) {
        translatedText = await this.translateChunkWithRetry(
          pdfTranslate,
          block.text,
          itemID,
          ++completed,
          total,
          onProgress,
        );
      } else {
        completed += 1;
      }

      translatedBlocks.push({
        type: "text",
        originalText: block.text,
        translatedText,
        level: block.level,
      });
    }

    onProgress?.({ current: total, total, stage: "done" });

    return {
      blocks: translatedBlocks,
      provider: "PDFTranslate.current",
    };
  }

  private static prepareStructuredBlocks(
    blocks: MineruStructuredBlock[],
    markdown: string,
  ): PreparedStructuredBlock[] {
    const merged = this.mergeBrokenParagraphBlocks(blocks);
    return this.restoreReferenceTailFromMarkdown(merged, markdown);
  }

  private static restoreReferenceTailFromMarkdown(
    blocks: PreparedStructuredBlock[],
    markdown: string,
  ) {
    const markdownBlocks = this.splitBlocks(markdown).map((block) => block.raw);
    const markdownRefIndex = markdownBlocks.findIndex((block) =>
      this.isReferenceSection(block),
    );
    if (markdownRefIndex < 0) {
      return blocks;
    }

    const structuredRefIndex = blocks.findIndex(
      (block) => block.type === "text" && !!block.level && this.isReferenceSection(block.text),
    );

    const referenceBlocks = markdownBlocks.slice(markdownRefIndex).map((raw, index) => {
      const match = raw.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        return {
          type: "text" as const,
          text: match[2].trim(),
          level: match[1].length,
        };
      }
      return {
        type: "text" as const,
        text: raw,
      };
    });

    if (structuredRefIndex >= 0) {
      return [...blocks.slice(0, structuredRefIndex), ...referenceBlocks];
    }

    return [...blocks, ...referenceBlocks];
  }

  private static countTranslatableUnits(blocks: PreparedStructuredBlock[]) {
    let total = 0;
    for (const block of blocks) {
      if (block.type === "text") {
        total += 1;
        continue;
      }
      if (block.type === "table") {
        if (block.caption?.trim()) total += 1;
        total += this.countTableCells(block.html);
        continue;
      }
      if (block.type === "image" && block.caption?.trim()) {
        total += 1;
      }
    }
    return Math.max(total, 1);
  }

  private static countTableCells(html: string) {
    const matches = html.match(/<(td|th)\b[^>]*>[\s\S]*?<\/\1>/gi);
    if (!matches) {
      return 0;
    }
    return matches.filter((cell) => this.shouldTranslateTableCell(this.stripHTML(cell))).length;
  }

  private static getPDFTranslateAPI() {
    const pdfTranslate = (Zotero as any).PDFTranslate;
    if (!pdfTranslate?.api?.translate) {
      throw new Error(
        "Translate for Zotero is not available. Please make sure the PDF Translate plugin is installed and enabled.",
      );
    }
    return pdfTranslate;
  }

  private static async translateChunkWithRetry(
    pdfTranslate: any,
    chunk: string,
    itemID?: number,
    current = 1,
    total = 1,
    onProgress?: (progress: TranslationProgress) => void,
  ) {
    const protectedMath = prepareMathForTranslation(chunk);
    const sourceText = protectedMath.text;
    let lastError = "Unknown translation error";
    for (let attempt = 1; attempt <= 5; attempt++) {
      TranslationControl.throwIfStopped();
      onProgress?.({
        current,
        total,
        stage: attempt === 1 ? "translating" : "retrying",
        retries: attempt - 1,
      });
      const task = await pdfTranslate.api.translate(sourceText, {
        pluginID: addon.data.config.addonID,
        itemID,
      });
      if (task?.status === "success" && task.result) {
        return restoreProtectedMathSegments(task.result, protectedMath.segments);
      }
      lastError = task?.result || task?.status || lastError;
      if (attempt < 5) {
        TranslationControl.throwIfStopped();
        await Zotero.Promise.delay(5000 * attempt);
      }
    }
    throw new Error(`Translation failed after retry: ${lastError}`);
  }

  private static async translateAuxiliaryText(
    pdfTranslate: any,
    text: string,
    itemID: number | undefined,
    current: number,
    total: number,
    onProgress?: (progress: TranslationProgress) => void,
  ) {
    if (!text.trim()) {
      return text;
    }
    return this.translateChunkWithRetry(
      pdfTranslate,
      text,
      itemID,
      current,
      total,
      onProgress,
    );
  }

  private static async translateTableHTML(
    pdfTranslate: any,
    html: string,
    itemID: number | undefined,
    nextProgress: () => { current: number; total: number },
    onProgress?: (progress: TranslationProgress) => void,
  ) {
    const cellRegex = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let result = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = cellRegex.exec(html))) {
      result += html.slice(lastIndex, match.index);
      const [fullMatch, tag, attrs, inner] = match;
      const plainText = this.stripHTML(inner).trim();
      if (!this.shouldTranslateTableCell(plainText)) {
        result += fullMatch;
      } else {
        const progress = nextProgress();
        const translated = await this.translateAuxiliaryText(
          pdfTranslate,
          plainText,
          itemID,
          progress.current,
          progress.total,
          onProgress,
        );
        result += `<${tag}${attrs}>${this.escapeHTML(translated)}</${tag}>`;
      }
      lastIndex = match.index + fullMatch.length;
    }
    result += html.slice(lastIndex);
    return result;
  }

  private static shouldTranslateTableCell(text: string) {
    if (!text.trim()) {
      return false;
    }
    if (/^[\d\s.%()+\-–—/:;,]+$/.test(text.trim())) {
      return false;
    }
    return /[A-Za-z]/.test(text);
  }

  private static stripHTML(html: string) {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#x27;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static escapeHTML(text: string) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private static isReferenceSection(chunk: string) {
    const firstLine = chunk.split(/\n/).find((line) => line.trim()) || "";
    const normalized = firstLine
      .replace(/^#+\s*/, "")
      .replace(/[*_`:#]/g, "")
      .trim()
      .toLowerCase();
    return [
      "references",
      "reference",
      "bibliography",
      "literature cited",
      "works cited",
      "参考文献",
      "参考资料",
    ].some((keyword) => normalized === keyword);
  }

  private static mergeBrokenParagraphBlocks(blocks: MineruStructuredBlock[]) {
    const merged: MineruStructuredBlock[] = [];

    for (const block of blocks) {
      if (block.type !== "text") {
        merged.push({ ...block });
        continue;
      }

      const targetIndex = this.findPreviousMergeTargetIndex(merged, block.text, block.level);
      if (targetIndex >= 0) {
        const target = merged[targetIndex] as Extract<MineruStructuredBlock, { type: "text" }>;
        target.text = this.joinParagraphText(target.text, block.text);
        continue;
      }

      merged.push({ ...block });
    }

    return merged;
  }

  private static findPreviousMergeTargetIndex(
    merged: MineruStructuredBlock[],
    currentText: string,
    currentLevel?: number,
  ) {
    if (currentLevel || !this.shouldMergeIntoPreviousParagraph(currentText)) {
      return -1;
    }

    for (let index = merged.length - 1; index >= 0; index--) {
      const candidate = merged[index];
      if (candidate.type === "text") {
        if (
          candidate.level ||
          this.isReferenceSection(candidate.text) ||
          this.endsLikeCompleteParagraph(candidate.text)
        ) {
          return -1;
        }
        return index;
      }
      if (candidate.type !== "image" && candidate.type !== "table") {
        return -1;
      }
    }

    return -1;
  }

  private static shouldMergeIntoPreviousParagraph(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    return !/^[A-Z]/.test(trimmed);
  }

  private static endsLikeCompleteParagraph(text: string) {
    return /[.!?。！？:：”"')\]]\s*$/.test(text.trim());
  }

  private static joinParagraphText(previous: string, current: string) {
    const prev = previous.trimEnd();
    const next = current.trimStart();
    if (!prev) {
      return next;
    }
    if (!next) {
      return prev;
    }
    if (prev.endsWith("-")) {
      return `${prev.slice(0, -1)}${next}`;
    }
    return `${prev} ${next}`;
  }

  private static splitBlocks(markdown: string): MarkdownBlock[] {
    const blocks = this.mergeBrokenMarkdownBlocks(
      markdown
      .replace(/\r\n/g, "\n")
      .replace(/(^\s*!\[[^\]]*\]\([^)]+\)\s*$)\n(?!\s*\n)/gm, "$1\n\n")
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean),
    );

    return (blocks.length ? blocks : [markdown]).map((raw) => ({
      raw,
      translatable: !/^\s*!\[[^\]]*\]\([^)]+\)\s*$/m.test(raw) &&
        !/^\s*\|.*\|\s*$/m.test(raw) &&
        !/^\s*[-:| ]+\s*$/m.test(raw) &&
        !raw.includes("<table") &&
        !raw.includes("</table>") &&
        !/^\s*```/.test(raw) &&
        !/^\s*(?:\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\])\s*$/.test(raw),
      isReferenceHeading: this.isReferenceSection(raw),
    }));
  }

  private static isHTMLTableBlock(block: string) {
    return block.includes("<table") && block.includes("</table>");
  }

  private static mergeBrokenMarkdownBlocks(blocks: string[]) {
    const merged: string[] = [];
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) {
        continue;
      }
      const targetIndex = this.findPreviousMarkdownMergeTargetIndex(merged, trimmed);
      if (targetIndex >= 0) {
        merged[targetIndex] = this.joinParagraphText(merged[targetIndex], trimmed);
        continue;
      }
      merged.push(trimmed);
    }
    return merged;
  }

  private static findPreviousMarkdownMergeTargetIndex(merged: string[], currentBlock: string) {
    if (!this.shouldMergeMarkdownIntoPrevious(currentBlock)) {
      return -1;
    }
    for (let index = merged.length - 1; index >= 0; index--) {
      const candidate = merged[index];
      if (this.isNonParagraphMarkdownBlock(candidate)) {
        return -1;
      }
      if (this.endsLikeCompleteParagraph(candidate)) {
        return -1;
      }
      return index;
    }
    return -1;
  }

  private static shouldMergeMarkdownIntoPrevious(block: string) {
    const firstLine = block.split("\n").find((line) => line.trim())?.trim() || "";
    if (!firstLine) {
      return false;
    }
    if (this.isNonParagraphMarkdownBlock(block)) {
      return false;
    }
    return !/^[A-Z]/.test(firstLine);
  }

  private static isNonParagraphMarkdownBlock(block: string) {
    const trimmed = block.trim();
    return (
      /^\s*!\[[^\]]*\]\([^)]+\)\s*$/m.test(trimmed) ||
      /^\s*#{1,6}\s+/.test(trimmed) ||
      /^\s*```/.test(trimmed) ||
      /^\s*\|.*\|\s*$/m.test(trimmed) ||
      /^\s*[-:| ]+\s*$/m.test(trimmed) ||
      trimmed.includes("<table") ||
      trimmed.includes("</table>")
    );
  }
}

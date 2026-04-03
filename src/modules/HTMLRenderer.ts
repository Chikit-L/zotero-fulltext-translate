import {
  extractProtectedMathSegments,
  normalizeScientificText,
  renderFormulaToMathML,
  restoreProtectedMathSegments,
} from "./MathProcessor";
import type { TranslatedStructuredBlock } from "./TranslationAdapter";

type MarkdownImageMap = Record<string, string>;

function escapeHTML(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function prepareText(input: string) {
  return normalizeScientificText(input);
}

function inlineMarkdown(input: string) {
  return input
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(
      /(?:\[(\d+(?:\s*[-,]\s*\d+)*)\]|【(\d+(?:\s*[-,]\s*\d+)*)】)/g,
      (_, squareValue: string, cornerValue: string) =>
        `<sup class="citation-ref">[${squareValue || cornerValue}]</sup>`,
    );
}

function renderRichText(input: string) {
  const normalized = input.replace(/\r\n/g, "\n");
  const { text, segments } = extractProtectedMathSegments(normalized);
  const html = inlineMarkdown(escapeHTML(text));
  return restoreProtectedMathSegments(html, segments, (raw) =>
    renderFormulaToMathML(raw, escapeHTML),
  );
}

function renderMarkdownImage(
  rawLine: string,
  markdownImageMap?: MarkdownImageMap,
) {
  const match = rawLine.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
  if (!match) {
    return "";
  }
  const alt = match[1] || "";
  const src = (markdownImageMap?.[match[2].trim()] || match[2].trim()).trim();
  return `<p><img src="${escapeHTML(src)}" alt="${escapeHTML(alt)}" /></p>`;
}

function isDisplayFormulaBlock(markdown: string) {
  const trimmed = markdown.trim();
  return (
    (/^\$\$[\s\S]*\$\$$/.test(trimmed) && trimmed.length > 4) ||
    (/^\\\[[\s\S]*\\\]$/.test(trimmed) && trimmed.length > 4)
  );
}

function splitBlocks(markdown: string) {
  return mergeBrokenMarkdownBlocks(
    markdown
    .replace(/\r\n/g, "\n")
    .replace(/(^\s*!\[[^\]]*\]\([^)]+\)\s*$)\n(?!\s*\n)/gm, "$1\n\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean),
  );
}

function mergeBrokenMarkdownBlocks(blocks: string[]) {
  const merged: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }
    const targetIndex = findPreviousMarkdownMergeTargetIndex(merged, trimmed);
    if (targetIndex >= 0) {
      merged[targetIndex] = joinMarkdownParagraphText(merged[targetIndex], trimmed);
      continue;
    }
    merged.push(trimmed);
  }
  return merged;
}

function findPreviousMarkdownMergeTargetIndex(merged: string[], currentBlock: string) {
  if (!shouldMergeMarkdownIntoPrevious(currentBlock)) {
    return -1;
  }
  for (let index = merged.length - 1; index >= 0; index--) {
    const candidate = merged[index];
    if (isNonParagraphMarkdownBlock(candidate)) {
      return -1;
    }
    if (/[.!?。！？:：”"')\]]\s*$/.test(candidate.trim())) {
      return -1;
    }
    return index;
  }
  return -1;
}

function shouldMergeMarkdownIntoPrevious(block: string) {
  const firstLine = block.split("\n").find((line) => line.trim())?.trim() || "";
  if (!firstLine) {
    return false;
  }
  if (isNonParagraphMarkdownBlock(block)) {
    return false;
  }
  return !/^[A-Z]/.test(firstLine);
}

function isNonParagraphMarkdownBlock(block: string) {
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

function joinMarkdownParagraphText(previous: string, current: string) {
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

function isImageBlock(block: string) {
  return /^\s*(?:<!--\s*image\s*-->|!\[[^\]]*\]\([^)]+\))\s*$/im.test(block);
}

function isTableBlock(block: string) {
  return (
    /^\s*\|.*\|\s*$/m.test(block) ||
    /^\s*[-:| ]+\s*$/m.test(block) ||
    block.includes("<table") ||
    block.includes("</table>")
  );
}

function normalizeBlock(block: string) {
  return prepareText(block).replace(/\s+/g, " ").trim();
}

function normalizeTitle(text: string) {
  return prepareText(text)
    .replace(/^#+\s*/, "")
    .replace(/[“”"'`*_#:.：,，;；!?！？()（）\[\]{}-]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function clampHeadingLevel(level?: number) {
  return Math.max(2, Math.min(level || 2, 6));
}

function cleanTranslatedText(text: string, originalText?: string) {
  let cleaned = prepareText(text).trim();
  cleaned = cleaned.replace(/^标题[:：]\s*.*?文本翻译[:：]\s*/u, "");
  if (originalText && /^#{1,6}\s+/.test(originalText.trim())) {
    cleaned = cleaned.replace(/^#{1,6}\s*/, "");
  }
  if (originalText) {
    const escaped = prepareText(originalText).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`^${escaped}\\s*[:：-]?\\s*`, "u"), "");
  }
  return cleaned.trim();
}

function markdownBlockToHTML(
  markdown: string,
  titleLevel = 2,
  markdownImageMap?: MarkdownImageMap,
) {
  if (isDisplayFormulaBlock(markdown)) {
    return `<div class="formula-block">${renderFormulaToMathML(markdown.trim(), escapeHTML)}</div>`;
  }
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const preparedLine = prepareText(rawLine);
    const line = preparedLine.replace(/\s+$/, "");
    if (line.startsWith("```")) {
      closeList();
      if (!inCode) {
        html.push("<pre><code>");
        inCode = true;
      } else {
        html.push("</code></pre>");
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      html.push(`${escapeHTML(rawLine)}\n`);
      continue;
    }
    if (!line) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      html.push(`<h${titleLevel}>${renderRichText(heading[2])}</h${titleLevel}>`);
      continue;
    }
    const imageHTML = renderMarkdownImage(rawLine, markdownImageMap);
    if (imageHTML) {
      closeList();
      html.push(imageHTML);
      continue;
    }
    const list = line.match(/^[-*]\s+(.*)$/);
    if (list) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderRichText(list[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderRichText(line)}</p>`);
  }
  closeList();
  if (inCode) {
    html.push("</code></pre>");
  }
  return html.join("\n");
}

function baseStyles() {
  return `
    #mode-toggle {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    #mode-toggle:not(:checked) ~ .wrap .original-translated {
      display: none !important;
    }
    #mode-toggle:checked ~ .wrap .translated {
      display: none !important;
    }
    body {
      margin: 0;
      padding: 24px;
      color: #222;
      background: #fff;
      font: 16px/1.8 "Times New Roman", "Noto Serif SC", serif;
    }
    .wrap {
      max-width: 860px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 16px;
      font-size: 28px;
      line-height: 1.4;
    }
    h2, h3, h4, h5, h6 {
      margin: 24px 0 12px;
      line-height: 1.5;
      font-weight: 700;
    }
    h2 { font-size: 22px; }
    h3 { font-size: 20px; }
    h4 { font-size: 18px; }
    h5, h6 { font-size: 17px; }
    p, li {
      margin: 0 0 12px;
    }
    .citation-ref {
      font-size: 0.75em;
      line-height: 0;
      vertical-align: super;
    }
    ul {
      margin: 0 0 12px 24px;
      padding: 0;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid #ddd;
      padding: 12px;
      margin: 0 0 12px;
    }
    .formula-block {
      margin: 0 0 12px;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 12px;
      font-size: 14px;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 6px 8px;
      vertical-align: top;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 0 12px;
    }
    .pair,
    .single-block,
    .heading-block,
    .table-block,
    .image-block {
      margin-bottom: 18px;
    }
    .source-block {
      margin-bottom: 8px;
    }
    .source-heading-text {
      margin: 0 0 12px;
      color: #555;
      font-style: italic;
    }
    .source-block p,
    .source-block li,
    .source-block h2,
    .source-block h3,
    .source-block h4,
    .source-block h5,
    .source-block h6,
    .caption .source-block p {
      border-left: 3px solid #d33;
      padding-left: 10px;
      background: rgba(211, 51, 51, 0.03);
    }
    .target-block p,
    .target-block li,
    .target-block h2,
    .target-block h3,
    .target-block h4,
    .target-block h5,
    .target-block h6,
    .caption .target-block p {
      border-left: 3px solid #2f6fed;
      padding-left: 10px;
      background: rgba(47, 111, 237, 0.03);
    }
    .toolbar {
      position: fixed;
      top: 50%;
      right: 24px;
      z-index: 999;
      transform: translateY(-50%);
    }
    .toggle-button {
      display: inline-block;
      padding: 8px 14px;
      border: 1px solid #999;
      border-radius: 999px;
      cursor: pointer;
      user-select: none;
      color: #222;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
    }
    .toggle-button:hover {
      background: #fff;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.16);
    }
    .caption {
      color: #555;
      font-size: 14px;
    }
    .caption p {
      margin-bottom: 10px;
    }
  `;
}

function renderFrame(title: string, sectionsHTML: string) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHTML(title)}</title>
  <style>${baseStyles()}</style>
</head>
<body>
  <input id="mode-toggle" type="checkbox" />
  <div class="wrap">
    <div class="toolbar">
      <label class="toggle-button" for="mode-toggle">切换 中英/纯中</label>
    </div>
    <h1>${escapeHTML(title)}</h1>
    ${sectionsHTML}
  </div>
</body>
</html>`;
}

function renderCaptionPair(originalText?: string, translatedText?: string) {
  const original = originalText?.trim() || "";
  const translated = cleanTranslatedText(translatedText || original, original) || prepareText(original);
  if (!original && !translated) {
    return "";
  }
  const sameContent = !original || normalizeBlock(original) === normalizeBlock(translated);
  if (sameContent) {
    return `
        <div class="caption">
          <span class="original-translated"><p>${renderRichText(translated)}</p></span>
          <span class="translated"><p>${renderRichText(translated)}</p></span>
        </div>`;
  }
  return `
        <div class="caption">
          <div class="original-translated">
            <div class="source-block"><p>${renderRichText(original)}</p></div>
            <div class="target-block"><p>${renderRichText(translated)}</p></div>
          </div>
          <div class="translated"><p>${renderRichText(translated)}</p></div>
        </div>`;
}

export class HTMLRenderer {
  static render(
    title: string,
    sourceMarkdown: string,
    translatedMarkdown: string,
    markdownImageMap?: MarkdownImageMap,
  ) {
    return this.renderBlocks(
      title,
      splitBlocks(sourceMarkdown),
      splitBlocks(translatedMarkdown),
      markdownImageMap,
    );
  }

  static renderFromBlocks(
    title: string,
    sourceBlocks: string[],
    translatedBlocks: string[],
    markdownImageMap?: MarkdownImageMap,
  ) {
    return this.renderBlocks(title, sourceBlocks, translatedBlocks, markdownImageMap);
  }

  private static renderBlocks(
    title: string,
    sourceBlocks: string[],
    translatedBlocks: string[],
    markdownImageMap?: MarkdownImageMap,
  ) {
    const sections: string[] = [];
    let imageIndex = 1;

    for (let index = 0; index < sourceBlocks.length; index++) {
      const sourceBlock = sourceBlocks[index];
      const translatedBlock = translatedBlocks[index] || "";
      const sourceHeading = sourceBlock.match(/^#{1,6}\s+(.*)$/);

      if (isImageBlock(sourceBlock)) {
        const sourceHTML = markdownBlockToHTML(sourceBlock, 2, markdownImageMap);
        sections.push(`
      <section class="single-block">
        <span class="original-translated">${sourceHTML}</span>
        <span class="translated">${sourceHTML}</span>
      </section>`);
        imageIndex += 1;
        continue;
      }

      if (isTableBlock(sourceBlock)) {
        const sourceHTML = sourceBlock;
        const targetHTML = translatedBlock || sourceBlock;
        const sameTable = normalizeBlock(sourceBlock) === normalizeBlock(translatedBlock || sourceBlock);
        sections.push(`
      <section class="table-block">
        <div class="original-translated">${sourceHTML}</div>
        <div class="translated">${sameTable ? sourceHTML : targetHTML}</div>
      </section>`);
        continue;
      }

      if (sourceHeading) {
        const headingLevel = clampHeadingLevel(sourceHeading[0].match(/^#+/)?.[0].length || 2);
        const originalText = sourceHeading[1].trim();
        const translatedText = cleanTranslatedText(translatedBlock, sourceBlock).replace(/^#+\s*/, "").trim() || originalText;
        if (normalizeTitle(originalText) === normalizeTitle(title)) {
          continue;
        }
        const targetHTML = `<h${headingLevel}>${renderRichText(translatedText)}</h${headingLevel}>`;
        const sourceLead = normalizeTitle(originalText) !== normalizeTitle(translatedText)
          ? `<div class="original-translated"><p class="source-heading-text">${renderRichText(originalText)}</p></div>`
          : "";
        sections.push(`
      <section class="heading-block">
        ${targetHTML}
        ${sourceLead}
      </section>`);
        continue;
      }

      const sourceHTML = markdownBlockToHTML(sourceBlock, 2, markdownImageMap);
      const targetHTML = markdownBlockToHTML(translatedBlock || sourceBlock, 2, markdownImageMap);
      const sameContent = normalizeBlock(sourceBlock) === normalizeBlock(translatedBlock || sourceBlock);

      if (sameContent) {
        sections.push(`
      <section class="single-block">
        <span class="original-translated">${sourceHTML}</span>
        <span class="translated">${sourceHTML}</span>
      </section>`);
        continue;
      }

      sections.push(`
      <section class="pair">
        <div class="original-translated">
          <div class="source-block">${sourceHTML}</div>
          <div class="target-block">${targetHTML}</div>
        </div>
        <div class="translated">${targetHTML}</div>
      </section>`);
    }

    return renderFrame(title, sections.join("\n"));
  }

  static renderStructured(title: string, blocks: TranslatedStructuredBlock[]) {
    const sections: string[] = [];
    let imageIndex = 1;

    for (const block of blocks) {
      if (block.type === "image") {
        const imageHTML = block.dataUrl
          ? `<img src="${block.dataUrl}" alt="图片${imageIndex}" />`
          : `<p>（图片${imageIndex}）</p>`;
        const captionHTML = renderCaptionPair(block.originalCaption, block.translatedCaption);
        sections.push(`
      <section class="image-block">
        ${imageHTML}
        ${captionHTML}
      </section>`);
        imageIndex += 1;
        continue;
      }

      if (block.type === "table") {
        const captionHTML = renderCaptionPair(block.originalCaption, block.translatedCaption);
        const translatedTableHTML = block.translatedHtml || block.originalHtml;
        const sameTable = normalizeBlock(block.originalHtml) === normalizeBlock(translatedTableHTML);
        sections.push(`
      <section class="table-block">
        ${captionHTML}
        <div class="original-translated">${block.originalHtml}</div>
        <div class="translated">${sameTable ? block.originalHtml : translatedTableHTML}</div>
      </section>`);
        continue;
      }

      const originalText = block.originalText.trim();
      const translatedText = cleanTranslatedText(block.translatedText, originalText) || block.translatedText.trim() || originalText;
      if (block.level) {
        if (normalizeTitle(translatedText) === normalizeTitle(title)) {
          continue;
        }
        const headingLevel = clampHeadingLevel(block.level + 1);
        const headingHTML = `<h${headingLevel}>${renderRichText(translatedText)}</h${headingLevel}>`;
        const sourceLead = normalizeTitle(originalText) !== normalizeTitle(translatedText)
          ? `<div class="original-translated"><p class="source-heading-text">${renderRichText(originalText)}</p></div>`
          : "";
        sections.push(`
      <section class="heading-block">
        ${headingHTML}
        ${sourceLead}
      </section>`);
        continue;
      }

      const sourceHTML = markdownBlockToHTML(originalText, 2);
      const targetHTML = markdownBlockToHTML(translatedText, 2);
      const sameContent = normalizeBlock(originalText) === normalizeBlock(translatedText);
      if (sameContent) {
        sections.push(`
      <section class="single-block">
        <span class="original-translated">${sourceHTML}</span>
        <span class="translated">${sourceHTML}</span>
      </section>`);
        continue;
      }
      sections.push(`
      <section class="pair">
        <div class="original-translated">
          <div class="source-block">${sourceHTML}</div>
          <div class="target-block">${targetHTML}</div>
        </div>
        <div class="translated">${targetHTML}</div>
      </section>`);
    }

    return renderFrame(title, sections.join("\n"));
  }
}

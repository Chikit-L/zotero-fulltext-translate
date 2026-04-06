import katex from "katex";

const INLINE_TOKEN_PREFIX = "$FTT_MATH_";
const INLINE_TOKEN_SUFFIX = "$";
const INLINE_TOKEN_PATTERN =
  /\$+\s*FTT_MATH_(\d+)\s*\$+|<\s*FTT_MATH_(\d+)\s*\/>|__FTT_INLINE_MATH_(\d+)__|FTT_INLINE_MATH_(\d+)__|FTT_MATH_(\d+)\$|FTT_MATH_(\d+)/g;

export function extractProtectedMathSegments(input: string) {
  return protectInlineMath(input);
}

export function prepareMathForTranslation(input: string) {
  return protectInlineMath(input);
}

export function restoreProtectedMathSegments(
  input: string,
  segments: string[],
  transform: (raw: string) => string = (raw) => raw,
) {
  return input.replace(
    INLINE_TOKEN_PATTERN,
    (
      _,
      valueA: string,
      valueB: string,
      valueC: string,
      valueD: string,
      valueE: string,
      valueF: string,
    ) => {
      const index = Number(valueA || valueB || valueC || valueD || valueE || valueF);
      return transform(segments[index] || "");
    },
  );
}

export function normalizeScientificText(input: string) {
  return input.replace(/\r\n/g, "\n");
}

export function renderFormulaToMathML(raw: string, escapeHTML: (input: string) => string) {
  const { expr, displayMode } = stripMathDelimiters(raw);
  try {
    return katex.renderToString(expr.trim(), {
      throwOnError: false,
      output: "mathml",
      displayMode,
      strict: "ignore",
    });
  } catch {
    return escapeHTML(raw);
  }
}

function protectInlineMath(input: string) {
  const segments: string[] = [];
  let text = input;
  let index = 0;

  while (index < text.length) {
    if (text.startsWith("$$", index)) {
      const end = text.indexOf("$$", index + 2);
      if (end >= 0) {
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "$") {
      const end = findInlineMathEnd(text, index + 1);
      if (end > index + 1) {
        const raw = text.slice(index, end + 1);
        const token = `${INLINE_TOKEN_PREFIX}${segments.length}${INLINE_TOKEN_SUFFIX}`;
        segments.push(raw);
        text = `${text.slice(0, index)}${token}${text.slice(end + 1)}`;
        index += token.length;
        continue;
      }
    }

    index += 1;
  }

  return { text, segments };
}

function findInlineMathEnd(input: string, start: number) {
  for (let index = start; index < input.length; index++) {
    if (input[index] !== "$") {
      continue;
    }
    if (input[index - 1] === "\\") {
      continue;
    }
    return index;
  }
  return -1;
}

function stripMathDelimiters(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
    return { expr: trimmed.slice(2, -2), displayMode: true };
  }
  if (trimmed.startsWith("$") && trimmed.endsWith("$")) {
    return { expr: trimmed.slice(1, -1), displayMode: false };
  }
  return { expr: trimmed, displayMode: false };
}

import katex from "katex";

const FORMULA_TOKEN_PREFIX = "__FTT_FORMULA_";

const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
};

const MATH_PATTERNS = [
  /\$\$[\s\S]+?\$\$/g,
  /\\\[[\s\S]+?\\\]/g,
  /\\\([\s\S]+?\\\)/g,
  /\$[^$\n]+\$/g,
  /\\[A-Za-z]+\s*\{[^{}\n]+\}(?:\s*(?:_\{?[^{}\s]+\}?|\^\{?[^{}\s]+\}?))*/g,
  /\b(?:[A-Za-z][A-Za-z0-9()]*)\s*(?:_\{?[-+0-9A-Za-z]+\}?|\^\{?[-+0-9A-Za-z]+\}?)+(?:\s*(?:_\{?[-+0-9A-Za-z]+\}?|\^\{?[-+0-9A-Za-z]+\}?))*/g,
  /\b\d+(?:\.\d+)?\s*\^\s*\{?[-+]?\d+\}?/g,
  /\d+\s*\\%\b/g,
];

export function extractProtectedMathSegments(input: string) {
  const segments: string[] = [];
  let text = input;
  for (const pattern of MATH_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, (match) => {
      const index = segments.push(match) - 1;
      return `${FORMULA_TOKEN_PREFIX}${index}__`;
    });
  }
  return { text, segments };
}

export function restoreProtectedMathSegments(
  input: string,
  segments: string[],
  transform: (raw: string) => string = (raw) => raw,
) {
  return input.replace(
    /__FTT_FORMULA_(\d+)__/g,
    (_, value: string) => transform(segments[Number(value)] || ""),
  );
}

export function normalizeScientificText(input: string) {
  return normalizeInlineScientificText(normalizeLatexMath(input));
}

export function renderFormulaToMathML(raw: string, escapeHTML: (input: string) => string) {
  const { expr, displayMode } = stripMathDelimiters(raw);
  try {
    return katex.renderToString(expr, {
      throwOnError: false,
      output: "mathml",
      displayMode,
      strict: "ignore",
    });
  } catch {
    return escapeHTML(normalizeScientificText(raw));
  }
}

function stripMathDelimiters(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
    return { expr: trimmed.slice(2, -2), displayMode: true };
  }
  if (trimmed.startsWith("\\[") && trimmed.endsWith("\\]")) {
    return { expr: trimmed.slice(2, -2), displayMode: true };
  }
  if (trimmed.startsWith("\\(") && trimmed.endsWith("\\)")) {
    return { expr: trimmed.slice(2, -2), displayMode: false };
  }
  if (trimmed.startsWith("$") && trimmed.endsWith("$")) {
    return { expr: trimmed.slice(1, -1), displayMode: false };
  }
  return { expr: trimmed, displayMode: false };
}

function normalizeLatexMath(input: string) {
  return input
    .replace(/\$\$?([\s\S]+?)\$\$?/g, (_, expr: string) => simplifyLatexExpression(expr))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, expr: string) => simplifyLatexExpression(expr))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, expr: string) => simplifyLatexExpression(expr));
}

function simplifyLatexExpression(expr: string) {
  let text = expr;
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/\\(?:mathrm|text|bar|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1");
  }
  text = text
    .replace(/\\[,:;!]/g, "")
    .replace(/\\([%#$&_])/g, "$1")
    .replace(/\{\s*([^{}]*?)\s*\}/g, "$1")
    .replace(/\\_/g, "_")
    .replace(/\\\^/g, "^")
    .replace(/\\([A-Za-z]+)/g, "$1");

  text = text
    .replace(/_\s*\{\s*([^{}]+?)\s*\}/g, (_, content: string) => toMappedScript(content, SUBSCRIPT_MAP))
    .replace(/\^\s*\{\s*([^{}]+?)\s*\}/g, (_, content: string) => toMappedScript(content, SUPERSCRIPT_MAP))
    .replace(/_([A-Za-z0-9+\-=()])/g, (_, content: string) => toMappedScript(content, SUBSCRIPT_MAP))
    .replace(/\^([A-Za-z0-9+\-=()])/g, (_, content: string) => toMappedScript(content, SUPERSCRIPT_MAP));

  return text.replace(/\s+/g, "").trim();
}

function normalizeInlineScientificText(input: string) {
  return input
    .replace(/\\%/g, "%")
    .replace(/\\([()])/g, "$1")
    .replace(/\\mathrm\s*\{([^{}]+)\}/g, "$1")
    .replace(/mathrm\s*\{([^{}]+)\}/g, "$1")
    .replace(/\\bar\s*\{([^{}]+)\}/g, "$1")
    .replace(/\\text\s*\{([^{}]+)\}/g, "$1")
    .replace(/([A-Za-z][A-Za-z0-9()]*)_\{?([0-9+\-]+)\}?\^\{?([0-9+\-]+)\}?/g, (_, base: string, sub: string, sup: string) =>
      `${base}${toMappedScript(sub, SUBSCRIPT_MAP)}${toMappedScript(sup, SUPERSCRIPT_MAP)}`,
    )
    .replace(/([A-Za-z][A-Za-z0-9()]*)\^\{?([0-9+\-]+)\}?/g, (_, base: string, sup: string) =>
      `${base}${toMappedScript(sup, SUPERSCRIPT_MAP)}`,
    )
    .replace(/([A-Za-z][A-Za-z0-9()]*)_\{?([0-9+\-]+)\}?/g, (_, base: string, sub: string) =>
      `${base}${toMappedScript(sub, SUBSCRIPT_MAP)}`,
    )
    .replace(/(\d+)\s*\^\s*\{?([0-9+\-]+)\}?/g, (_, base: string, sup: string) =>
      `${base}${toMappedScript(sup, SUPERSCRIPT_MAP)}`,
    )
    .replace(/\{\s*([^{}]+)\s*\}/g, "$1");
}

function toMappedScript(input: string, map: Record<string, string>) {
  const compact = input.replace(/\s+/g, "");
  let converted = "";
  for (const ch of compact) {
    converted += map[ch] || ch;
  }
  return converted;
}

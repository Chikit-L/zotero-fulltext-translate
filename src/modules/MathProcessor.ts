import katex from "katex";

const FORMULA_TOKEN_PREFIX = "⟪";
const FORMULA_TOKEN_SUFFIX = "⟫";

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
      return `${FORMULA_TOKEN_PREFIX}${index}${FORMULA_TOKEN_SUFFIX}`;
    });
  }
  return { text, segments };
}

export function prepareMathForTranslation(input: string) {
  const segments: string[] = [];
  let text = input;
  for (const pattern of MATH_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, (match) => {
      if (shouldNormalizeMathForTranslation(match)) {
        return normalizeScientificText(match);
      }
      const index = segments.push(match) - 1;
      return `${FORMULA_TOKEN_PREFIX}${index}${FORMULA_TOKEN_SUFFIX}`;
    });
  }
  return { text, segments };
}

export function restoreProtectedMathSegments(
  input: string,
  segments: string[],
  transform: (raw: string) => string = (raw) => raw,
) {
  return input
    .replace(
      /⟪(\d+)⟫/g,
      (_, value: string) => transform(segments[Number(value)] || ""),
    )
    .replace(/⟪⟫/g, () => (segments.length === 1 ? transform(segments[0] || "") : ""))
    .replace(
      /__FTT_(?:FORMULA|Formula)([0-9₀₁₂₃₄₅₆₇₈₉]+)__/g,
      (_, value: string) => transform(segments[parseTokenIndex(value)] || ""),
    )
    .replace(
      /FTTFORM[A-Z]*TOKEN(\d*)END/gi,
      (_, value: string) =>
        value
          ? transform(segments[Number(value)] || "")
          : segments.length === 1
            ? transform(segments[0] || "")
            : "",
    );
}

export function normalizeScientificText(input: string) {
  return normalizeInlineScientificText(normalizeLatexMath(input));
}

export function renderFormulaToMathML(raw: string, escapeHTML: (input: string) => string) {
  const { expr, displayMode } = stripMathDelimiters(raw);
  const repairedExpr = repairLatexExpression(expr);
  try {
    return katex.renderToString(repairedExpr, {
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

function shouldNormalizeMathForTranslation(raw: string) {
  const { expr, displayMode } = stripMathDelimiters(raw);
  if (displayMode) {
    return false;
  }

  const compact = expr.replace(/\s+/g, "");
  if (!compact) {
    return false;
  }

  if (/[\\]/.test(compact) && !/^\\?(?:mathrm|text|bar)\{[^{}]+\}$/.test(compact)) {
    return false;
  }

  return [
    /^[A-Za-z][A-Za-z0-9()]*(_\{?[-+0-9A-Za-z()]+\}?|\^\{?[-+0-9A-Za-z()]+\}?)+$/,
    /^\d+(?:\.\d+)?\^\{?[-+]?\d+\}?$/,
    /^\d+\\%$/,
    /^\\?(?:mathrm|text|bar)\{[^{}]+\}$/,
  ].some((pattern) => pattern.test(compact));
}

function normalizeLatexMath(input: string) {
  return input
    .replace(/\$\$?([\s\S]+?)\$\$?/g, (_, expr: string) => simplifyLatexExpression(repairLatexExpression(expr)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, expr: string) => simplifyLatexExpression(repairLatexExpression(expr)))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, expr: string) => simplifyLatexExpression(repairLatexExpression(expr)));
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

function repairLatexExpression(expr: string) {
  let text = expr.replace(/\r\n/g, "\n").trim();

  text = text
    .replace(/\\beginarray\b/g, "\\begin{array}")
    .replace(/\\endarray\b/g, "\\end{array}")
    .replace(/\\begin\s*array\s*([clr]+)/g, "\\begin{array}{$1}")
    .replace(/\\end\s*array\b/g, "\\end{array}")
    .replace(/\\begin\{array\}\s*([clr]+)/g, "\\begin{array}{$1}")
    .replace(/\\\s*\{\s*\\\s*\}/g, "\\\\")
    .replace(/\{\s*\{\s*/g, "{")
    .replace(/\s*\}\s*\}/g, "}")
    .replace(/\{\s*\\\s*\}/g, "")
    .replace(/_\s*([A-Za-z0-9])\s+([A-Za-z0-9])\b/g, "_{$1$2}")
    .replace(/\^\s*([A-Za-z0-9])\s+([A-Za-z0-9])\b/g, "^{$1$2}")
    .replace(/([A-Za-z])\s*_\s*([A-Za-z0-9])\s*([A-Za-z0-9])\b/g, "$1_{$2$3}")
    .replace(/([A-Za-z])\s*\^\s*([A-Za-z0-9])\s*([A-Za-z0-9])\b/g, "$1^{$2$3}")
    .replace(/\{\s*([A-Za-z])\s*_\s*([A-Za-z0-9])\s*([A-Za-z0-9])\s*\}/g, "{$1_{$2$3}}")
    .replace(/\{\s*([A-Za-z])\s*\^\s*([A-Za-z0-9])\s*([A-Za-z0-9])\s*\}/g, "{$1^{$2$3}}")
    .replace(/\\geq\b/g, "\\ge")
    .replace(/\n\s*\n+/g, "\n")
    .replace(/\s*\\\\\s*/g, " \\\\ ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function normalizeInlineScientificText(input: string) {
  return input
    .replace(/\\?textstyle/g, "")
    .replace(/\\?boldsymbol\s*\{?\s*([A-Za-z])\s*\}?/g, "$1")
    .replace(/\\?widehat\s*\{?\(?\s*([^{}()\\]+)\s*\)?\}?/g, "$1")
    .replace(/\\?cdot/g, "·")
    .replace(/\\%/g, "%")
    .replace(/\\([()])/g, "$1")
    .replace(/\\mathrm\s*\{([^{}]+)\}/g, "$1")
    .replace(/mathrm\s*\{([^{}]+)\}/g, "$1")
    .replace(/\\bar\s*\{([^{}]+)\}/g, "$1")
    .replace(/\\text\s*\{([^{}]+)\}/g, "$1")
    .replace(/\\([A-Za-z])\b/g, "$1")
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
    .replace(/([A-Za-z0-9)])·(?=[A-Za-z(])/g, "$1·")
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

function parseTokenIndex(input: string) {
  const normalized = input.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (digit) =>
    String("₀₁₂₃₄₅₆₇₈₉".indexOf(digit)),
  );
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : -1;
}

import { Plugin } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

const SUPPORTED_ALIASES = [
  "hcl",
  "terraform",
  "terraform-vars",
  "tf",
  "tfvars",
] as const;

let hclModulePromise: Promise<typeof import("codemirror-lang-hcl")> | null = null;
let lezerHighlightModulePromise: Promise<typeof import("@lezer/highlight")> | null = null;

function loadHclModule() {
  if (!hclModulePromise) {
    hclModulePromise = import("codemirror-lang-hcl");
  }

  return hclModulePromise;
}

function loadLezerHighlightModule() {
  if (!lezerHighlightModulePromise) {
    lezerHighlightModulePromise = import("@lezer/highlight");
  }

  return lezerHighlightModulePromise;
}

export default class HclTerraformSyntaxHighlightPlugin extends Plugin {
  async onload() {
    this.registerEditorExtension(hclTerraformEditorHighlighter);

    for (const language of SUPPORTED_ALIASES) {
      this.registerMarkdownCodeBlockProcessor(language, async (source, el) => {
        await renderHighlightedCodeBlock(source, language, el);
      });
    }
  }
}

const aliasPattern = SUPPORTED_ALIASES.join("|").replace(/\+/g, "\\+");
const fencePattern = new RegExp(`^\\s*\`{3,}\\s*(${aliasPattern})(?:\\s|$)`, "i");
const closingFencePattern = /^\s*`{3,}\s*$/;

const hclTerraformEditorHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildEditorDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildEditorDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function buildEditorDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const visibleRanges = view.visibleRanges;
  if (visibleRanges.length === 0) {
    return builder.finish();
  }

  const firstVisibleFrom = visibleRanges[0].from;
  const maxVisibleTo = visibleRanges[visibleRanges.length - 1].to;
  const firstVisibleLine = doc.lineAt(firstVisibleFrom);
  const maxVisibleLine = doc.lineAt(maxVisibleTo);
  let visibleRangeIndex = 0;
  let inSupportedFence = isInsideSupportedFenceBefore(doc, firstVisibleLine.from);

  for (
    let lineNumber = firstVisibleLine.number;
    lineNumber <= maxVisibleLine.number;
    lineNumber += 1
  ) {
    const line = doc.line(lineNumber);

    const text = line.text;
    const lineFrom = line.from;
    const lineTo = line.to;

    while (
      visibleRangeIndex < visibleRanges.length &&
      visibleRanges[visibleRangeIndex].to <= lineFrom
    ) {
      visibleRangeIndex += 1;
    }

    const isVisibleLine =
      visibleRangeIndex < visibleRanges.length &&
      visibleRanges[visibleRangeIndex].from < lineTo &&
      visibleRanges[visibleRangeIndex].to > lineFrom;

    if (!inSupportedFence && fencePattern.test(text)) {
      inSupportedFence = true;
      continue;
    }

    if (inSupportedFence && closingFencePattern.test(text)) {
      inSupportedFence = false;
      continue;
    }

    if (inSupportedFence && isVisibleLine) {
      addHclTokenDecorations(builder, line.from, text);
    }
  }

  return builder.finish();
}

function isInsideSupportedFenceBefore(
  doc: EditorView["state"]["doc"],
  position: number,
): boolean {
  if (position <= 0) {
    return false;
  }

  const prefix = doc.sliceString(0, position);
  const lines = prefix.split(/\r?\n/);
  let inSupportedFence = false;

  for (const line of lines) {
    if (!inSupportedFence && fencePattern.test(line)) {
      inSupportedFence = true;
      continue;
    }

    if (inSupportedFence && closingFencePattern.test(line)) {
      inSupportedFence = false;
    }
  }

  return inSupportedFence;
}

function addHclTokenDecorations(
  builder: RangeSetBuilder<Decoration>,
  lineStart: number,
  text: string,
) {
  const commentStart = findLineCommentStart(text);
  const codeText = commentStart === -1 ? text : text.slice(0, commentStart);
  const tokens: TokenDecoration[] = [];

  collectMatches(tokens, lineStart, codeText, /"([^"\\]|\\.)*"/g, "tok-string");
  const stringRanges = mergeRanges(tokens.filter((token) => token.className === "tok-string"));

  collectMatches(tokens, lineStart, codeText, /(^|[\s{[(,])([A-Za-z_][\w-]*)(?=\s*=)/g, "tok-propertyName", 2, stringRanges);
  collectMatches(tokens, lineStart, codeText, /\b(?:resource|data|module|variable|locals|output|provider|terraform|backend|required_providers|required_version|dynamic|for_each|count|depends_on|lifecycle|provisioner|connection|true|false|null)\b/g, "tok-keyword", 0, stringRanges);
  collectMatches(tokens, lineStart, codeText, /\b\d+(?:\.\d+)?\b/g, "tok-literal", 0, stringRanges);
  collectMatches(tokens, lineStart, codeText, /[{}[\]().,=]/g, "tok-punctuation", 0, stringRanges);

  if (commentStart !== -1) {
    tokens.push({
      from: lineStart + commentStart,
      to: lineStart + text.length,
      className: "tok-comment",
    });
  }

  tokens
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .forEach((token) => {
      builder.add(
        token.from,
        token.to,
        Decoration.mark({ class: `obsidian-hcl-terraform-editor-token ${token.className}` }),
      );
    });
}

type TokenDecoration = {
  from: number;
  to: number;
  className: string;
};

type TokenRange = {
  from: number;
  to: number;
};

function mergeRanges(ranges: TokenRange[]): TokenRange[] {
  if (ranges.length < 2) {
    return ranges;
  }

  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: TokenRange[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];

    if (current.from <= previous.to) {
      previous.to = Math.max(previous.to, current.to);
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

function collectMatches(
  tokens: TokenDecoration[],
  lineStart: number,
  text: string,
  pattern: RegExp,
  className: string,
  captureGroup = 0,
  excludedRanges: TokenRange[] = [],
) {
  for (const match of text.matchAll(pattern)) {
    const token = match[captureGroup];
    if (!token || match.index === undefined) {
      continue;
    }

    const prefixLength = captureGroup === 0 ? 0 : match[0].indexOf(token);
    const from = lineStart + match.index + prefixLength;
    const to = from + token.length;
    if (rangeOverlaps(excludedRanges, from, to)) {
      continue;
    }

    tokens.push({ from, to, className });
  }
}

function rangeOverlaps(ranges: TokenRange[], from: number, to: number): boolean {
  if (ranges.length === 0) {
    return false;
  }

  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];

    if (to <= range.from) {
      high = middle - 1;
      continue;
    }

    if (from >= range.to) {
      low = middle + 1;
      continue;
    }

    return true;
  }

  return false;
}

function findLineCommentStart(text: string): number {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (!inString && (char === "#" || (char === "/" && next === "/"))) {
      return index;
    }
  }

  return -1;
}

async function renderHighlightedCodeBlock(
  source: string,
  language: string,
  el: HTMLElement,
) {
  const [{ hclLanguage }, { classHighlighter, highlightTree }] = await Promise.all([
    loadHclModule(),
    loadLezerHighlightModule(),
  ]);

  const tree = hclLanguage.parser.parse(source);
  const preEl = document.createElement("pre");
  const codeEl = document.createElement("code");
  let cursor = 0;

  preEl.className = `obsidian-hcl-terraform-codeblock language-${language}`;
  codeEl.className = `obsidian-hcl-terraform-code language-${language}`;

  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > cursor) {
      codeEl.append(document.createTextNode(source.slice(cursor, from)));
    }

    const span = document.createElement("span");
    span.className = classes;
    span.textContent = source.slice(from, to);
    codeEl.append(span);
    cursor = to;
  });

  if (cursor < source.length) {
    codeEl.append(document.createTextNode(source.slice(cursor)));
  }

  preEl.append(codeEl);
  el.replaceChildren(preEl);
}

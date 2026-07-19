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

function loadHclModule() {
  if (!hclModulePromise) {
    hclModulePromise = import("codemirror-lang-hcl");
  }

  return hclModulePromise;
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
  let inSupportedFence = false;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const text = line.text;

    if (!inSupportedFence && fencePattern.test(text)) {
      inSupportedFence = true;
      continue;
    }

    if (inSupportedFence && closingFencePattern.test(text)) {
      inSupportedFence = false;
      continue;
    }

    if (inSupportedFence) {
      addHclTokenDecorations(builder, line.from, text);
    }
  }

  return builder.finish();
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
  const stringRanges = tokens.filter((token) => token.className === "tok-string");

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

function collectMatches(
  tokens: TokenDecoration[],
  lineStart: number,
  text: string,
  pattern: RegExp,
  className: string,
  captureGroup = 0,
  excludedRanges: TokenDecoration[] = [],
) {
  for (const match of text.matchAll(pattern)) {
    const token = match[captureGroup];
    if (!token || match.index === undefined) {
      continue;
    }

    const prefixLength = captureGroup === 0 ? 0 : match[0].indexOf(token);
    const from = lineStart + match.index + prefixLength;
    const to = from + token.length;
    if (excludedRanges.some((range) => from < range.to && to > range.from)) {
      continue;
    }

    tokens.push({ from, to, className });
  }
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
    import("@lezer/highlight"),
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

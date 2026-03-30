import { Plugin } from "obsidian";

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
    for (const language of SUPPORTED_ALIASES) {
      this.registerMarkdownCodeBlockProcessor(language, async (source, el) => {
        await renderHighlightedCodeBlock(source, language, el);
      });
    }
  }
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

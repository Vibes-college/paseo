import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_MARKDOWN_RENDER_CHARS,
  MAX_MARKDOWN_TOP_LEVEL_CHILDREN,
  constrainMarkdownForRender,
  createSafeMarkdownParser,
} from "../markdown-render-budget";

const TRUNCATION_MARKER = "\n\n…";

describe("Markdown render security budget", () => {
  it("bounds untrusted Markdown before parser work", () => {
    const input = `prefix-${"x".repeat(MAX_MARKDOWN_RENDER_CHARS * 2)}`;
    const result = constrainMarkdownForRender(input);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(MAX_MARKDOWN_RENDER_CHARS + TRUNCATION_MARKER.length);
    expect(result.text.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("keeps safe input byte-for-byte", () => {
    const input = "A short [explicit link](https://example.com).";
    expect(constrainMarkdownForRender(input)).toEqual({ text: input, truncated: false });
  });

  it("disables vulnerable automatic linkification and smartquotes", () => {
    const parser = createSafeMarkdownParser();
    expect(parser.options.html).toBe(false);
    expect(parser.options.linkify).toBe(false);
    expect(parser.options.typographer).toBe(false);
  });

  it("sets a finite AST render ceiling", () => {
    expect(MAX_MARKDOWN_TOP_LEVEL_CHILDREN).toBeGreaterThan(0);
    expect(MAX_MARKDOWN_TOP_LEVEL_CHILDREN).toBeLessThanOrEqual(512);
  });

  it("covers every direct Markdown parser and renderer entrypoint", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const assistantParser = read("../assistant-markdown-parser.ts");
    const splitter = read("../split-markdown-blocks.ts");
    const renderer = read("../../components/markdown/renderer.tsx");
    const planCard = read("../../components/plan-card.tsx");

    expect(assistantParser).toContain("createSafeMarkdownParser");
    expect(splitter).toContain("constrainMarkdownForRender");
    expect(renderer).toContain("constrainMarkdownForRender");
    expect(renderer).toContain("MAX_MARKDOWN_TOP_LEVEL_CHILDREN");
    expect(renderer).toContain("maxTopLevelChildren={MAX_MARKDOWN_TOP_LEVEL_CHILDREN}");
    expect(planCard).toContain("createSafeMarkdownParser");
    expect(planCard).toContain("constrainMarkdownForRender");
    expect(planCard).toContain("markdownit={planMarkdownParser}");
  });
});

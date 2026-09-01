import MarkdownIt from "markdown-it";

export const MAX_MARKDOWN_RENDER_CHARS = 64 * 1024;
export const MAX_MARKDOWN_TOP_LEVEL_CHILDREN = 512;

const MARKDOWN_TRUNCATION_MARKER = "\n\n…";

export function constrainMarkdownForRender(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= MAX_MARKDOWN_RENDER_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, MAX_MARKDOWN_RENDER_CHARS)}${MARKDOWN_TRUNCATION_MARKER}`,
    truncated: true,
  };
}

export function createSafeMarkdownParser(): MarkdownIt {
  return new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });
}

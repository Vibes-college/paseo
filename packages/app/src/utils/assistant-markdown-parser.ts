import type MarkdownIt from "markdown-it";
import { createSafeMarkdownParser } from "./markdown-render-budget";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = createSafeMarkdownParser();
  const defaultValidateLink = parser.validateLink.bind(parser);

  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}

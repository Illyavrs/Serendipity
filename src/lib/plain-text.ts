import { bbcodeToPlainText } from './bbcode';
import type { TextFormat } from './types';
/** Reduce Markdown to the text a reader would see, for list excerpts that must not show syntax. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*([-*_]\s*){3,}$/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut on code points so emoji and CJK text are never split mid-character. */
export function excerpt(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : text;
}

export function richTextToPlainText(source: string, format: TextFormat = 'markdown') {
  return format === 'bbcode' ? bbcodeToPlainText(source) : markdownToPlainText(source);
}

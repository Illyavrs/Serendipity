/** Bounded BBCode parsing. Content becomes data nodes, never HTML. */
export type BBNode = string | { tag: string; argument?: string; children: BBNode[] };
const tags = new Set([
  'b',
  'i',
  'u',
  's',
  'strike',
  'url',
  'quote',
  'code',
  'list',
  '*',
  'hr',
  'br',
  'h1',
  'h2',
  'h3',
  'table',
  'tr',
  'td',
  'th',
  'img',
  'spoiler',
  'center',
  'centre',
  'colour',
  'color',
  'size',
]);
const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#91': '[',
  '#93': ']',
};
export function decodeBBText(text: string) {
  return text.replace(/&(amp|lt|gt|quot|#91|#93);/g, (_, key: string) => entities[key]);
}
export function escapeBBText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
}
export function safeTextHref(value: string | undefined): string | undefined {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url = new URL(value, 'https://illyaverse.invalid');
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return value;
  } catch {
    /* Invalid URLs remain plain text. */
  }
}
export function parseBBCode(source: string): BBNode[] {
  const root: BBNode[] = [];
  const stack = [{ tag: '', children: root }];
  const tokens = /\[(\/?)([a-z][a-z0-9]*|\*)(?:=([^\]\n]*))?\]/gi;
  let offset = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  const append = (value: BBNode) => stack[stack.length - 1].children.push(value);
  while ((match = tokens.exec(source)) && count++ < 4000) {
    append(decodeBBText(source.slice(offset, match.index)));
    offset = tokens.lastIndex;
    const tag = match[2].toLowerCase();
    if (!tags.has(tag)) {
      append(match[0]);
      continue;
    }
    if (match[1]) {
      const at = stack.findLastIndex((node) => node.tag === tag);
      if (at > 0) stack.splice(at);
      else append(match[0]);
      continue;
    }
    if (stack.length > 24) {
      append(match[0]);
      continue;
    }
    const argument = match[3]?.trim().replace(/^"(.*)"$/, '$1');
    const node: Exclude<BBNode, string> = {
      tag,
      argument: argument ? decodeBBText(argument) : undefined,
      children: [],
    };
    if (tag === 'code' || tag === 'img') {
      const closing = new RegExp(`\\[/${tag}\\]`, 'gi');
      closing.lastIndex = offset;
      const end = closing.exec(source);
      if (!end) {
        append(match[0]);
        continue;
      }
      node.children.push(decodeBBText(source.slice(offset, end.index)));
      offset = closing.lastIndex;
      tokens.lastIndex = offset;
      append(node);
      continue;
    }
    if (tag === '*' && stack[stack.length - 1].tag === '*') stack.pop();
    append(node);
    if (!['hr', 'br'].includes(tag)) stack.push(node);
  }
  append(decodeBBText(source.slice(offset)));
  return root.filter((node) => node !== '');
}
export function bbcodeToPlainText(source: string): string {
  const text = (nodes: BBNode[]): string =>
    nodes
      .map((node) =>
        typeof node === 'string'
          ? node
          : text(node.children) +
            (['quote', 'list', '*', 'h1', 'h2', 'h3', 'br', 'tr'].includes(node.tag) ? '\n' : ''),
      )
      .join('');
  return text(parseBBCode(source));
}

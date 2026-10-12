import type { JSONContent } from '@tiptap/react';
import { escapeBBText, parseBBCode, safeTextHref, type BBNode } from './bbcode';

function inlines(nodes: BBNode[], marks: JSONContent['marks'] = []): JSONContent[] {
  return nodes.flatMap((node) => {
    if (typeof node === 'string')
      return node
        .split('\n')
        .flatMap((text, index) => [
          ...(index ? [{ type: 'hardBreak' }] : []),
          ...(text ? [{ type: 'text', text, marks }] : []),
        ]);
    const mark = {
      b: 'bold',
      i: 'italic',
      u: 'underline',
      s: 'strike',
      strike: 'strike',
      code: 'code',
    }[node.tag];
    if (mark) return inlines(node.children, [...marks, { type: mark }]);
    if (node.tag === 'url') {
      const href = safeTextHref(
        node.argument ?? node.children.filter((child) => typeof child === 'string').join(''),
      );
      return inlines(node.children, href ? [...marks, { type: 'link', attrs: { href } }] : marks);
    }
    if (['color', 'colour', 'size'].includes(node.tag))
      return inlines(node.children, [
        ...marks,
        { type: 'bbStyle', attrs: { tag: node.tag, argument: node.argument ?? '' } },
      ]);
    if (node.tag === 'img') return [{ type: 'bbImage', attrs: { src: node.children.join('') } }];
    if (node.tag === 'br') return [{ type: 'hardBreak' }];
    // Unsupported syntax is retained visibly, never silently discarded.
    return inlines(
      [
        `[${node.tag}${node.argument ? `=${node.argument}` : ''}]`,
        ...node.children,
        `[/${node.tag}]`,
      ],
      marks,
    );
  });
}
function blocks(nodes: BBNode[]): JSONContent[] {
  const result: JSONContent[] = [];
  let pending: BBNode[] = [];
  const flush = () => {
    if (!pending.length) return;
    const grouped: BBNode[][] = [[]];
    for (const node of pending) {
      if (typeof node === 'string') {
        node.split(/\n\s*\n/).forEach((part, index) => {
          if (index) grouped.push([]);
          grouped[grouped.length - 1].push(part);
        });
      } else grouped[grouped.length - 1].push(node);
    }
    for (const group of grouped) {
      const content = inlines(group);
      if (content.length) result.push({ type: 'paragraph', content });
    }
    pending = [];
  };
  for (const node of nodes) {
    if (
      typeof node === 'string' ||
      ![
        'quote',
        'code',
        'list',
        'h1',
        'h2',
        'h3',
        'hr',
        'table',
        'center',
        'centre',
        'spoiler',
      ].includes(node.tag)
    ) {
      pending.push(node);
      continue;
    }
    flush();
    const content = blocks(node.children);
    if (['center', 'centre', 'spoiler'].includes(node.tag))
      result.push({
        type: 'bbBlock',
        attrs: { tag: node.tag, argument: node.argument ?? '' },
        content: content.length ? content : [{ type: 'paragraph' }],
      });
    if (node.tag === 'quote')
      result.push({
        type: 'blockquote',
        content: content.length ? content : [{ type: 'paragraph' }],
      });
    if (node.tag === 'code')
      result.push({
        type: 'codeBlock',
        content: node.children.join('') ? [{ type: 'text', text: node.children.join('') }] : [],
      });
    if (/^h[123]$/.test(node.tag))
      result.push({
        type: 'heading',
        attrs: { level: Number(node.tag[1]) },
        content: inlines(node.children),
      });
    if (node.tag === 'hr') result.push({ type: 'horizontalRule' });
    if (node.tag === 'list') {
      const items = node.children
        .filter(
          (child): child is Exclude<BBNode, string> =>
            typeof child !== 'string' && child.tag === '*',
        )
        .map((child) => {
          const content = blocks(child.children);
          return { type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] };
        });
      if (items.length)
        result.push({ type: node.argument === '1' ? 'orderedList' : 'bulletList', content: items });
    }
    if (node.tag === 'table') {
      const rows = node.children
        .filter(
          (child): child is Exclude<BBNode, string> =>
            typeof child !== 'string' && child.tag === 'tr',
        )
        .map((row) => ({
          type: 'tableRow',
          content: row.children
            .filter(
              (child): child is Exclude<BBNode, string> =>
                typeof child !== 'string' && ['td', 'th'].includes(child.tag),
            )
            .map((cell) => {
              const content = blocks(cell.children);
              return {
                type: cell.tag === 'th' ? 'tableHeader' : 'tableCell',
                content: content.length ? content : [{ type: 'paragraph' }],
              };
            }),
        }))
        .filter((row) => row.content.length);
      if (rows.length) result.push({ type: 'table', content: rows });
    }
  }
  flush();
  return result;
}
export function bbcodeToEditor(source: string): JSONContent {
  const content = blocks(parseBBCode(source));
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
export function editorToBBCode(doc: JSONContent): string {
  const write = (node: JSONContent): string => {
    if (node.type === 'text') {
      let text = escapeBBText(node.text ?? '');
      for (const mark of node.marks ?? []) {
        const tag = { bold: 'b', italic: 'i', underline: 'u', strike: 's', code: 'code' }[
          mark.type
        ];
        if (tag) text = `[${tag}]${text}[/${tag}]`;
        if (mark.type === 'bbStyle') {
          const tag = ['color', 'colour', 'size'].includes(mark.attrs?.tag)
            ? mark.attrs!.tag
            : 'color';
          const argument = escapeBBText(String(mark.attrs?.argument ?? ''));
          text = `[${tag}=${argument}]${text}[/${tag}]`;
        }
        if (mark.type === 'link') {
          const href = safeTextHref(mark.attrs?.href);
          if (href) text = `[url=${escapeBBText(href).replace(/"/g, '&quot;')}]${text}[/url]`;
        }
      }
      return text;
    }
    const content = (node.content ?? []).map(write).join('');
    switch (node.type) {
      case 'doc':
        return content.trim();
      case 'paragraph':
        return `${content}\n\n`;
      case 'heading':
        return `[h${node.attrs?.level ?? 2}]${content}[/h${node.attrs?.level ?? 2}]\n\n`;
      case 'blockquote':
        return `[quote]${content.trim()}[/quote]\n\n`;
      case 'codeBlock':
        return `[code]${escapeBBText((node.content ?? []).map((child) => child.text ?? '').join(''))}[/code]\n\n`;
      case 'bulletList':
        return `[list]${content}[/list]\n\n`;
      case 'orderedList':
        return `[list=1]${content}[/list]\n\n`;
      case 'listItem':
        return `[*]${content.trim()}\n`;
      case 'bbImage':
        return `[img]${escapeBBText(String(node.attrs?.src ?? ''))}[/img]`;
      case 'bbBlock': {
        const tag = ['center', 'centre', 'spoiler'].includes(node.attrs?.tag)
          ? node.attrs!.tag
          : 'center';
        const argument = node.attrs?.argument
          ? `=${escapeBBText(String(node.attrs.argument))}`
          : '';
        return `[${tag}${argument}]${content.trim()}[/${tag}]\n\n`;
      }
      case 'hardBreak':
        return '\n';
      case 'horizontalRule':
        return '[hr]\n\n';
      case 'table':
        return `[table]${content}[/table]\n\n`;
      case 'tableRow':
        return `[tr]${content}[/tr]`;
      case 'tableHeader':
        return `[th]${content.trim()}[/th]`;
      case 'tableCell':
        return `[td]${content.trim()}[/td]`;
      default:
        return content;
    }
  };
  return write(doc);
}

import { Mark, Node } from '@tiptap/react';
import { safeTextHref } from '@/lib/bbcode';

export const BBStyle = Mark.create({
  name: 'bbStyle',
  excludes: '',
  addAttributes() {
    return { tag: { default: 'color' }, argument: { default: '' } };
  },
  renderHTML({ mark }) {
    const { tag, argument } = mark.attrs;
    const style =
      tag === 'size' && /^\d{2,3}$/.test(argument)
        ? `font-size:${Math.max(75, Math.min(200, Number(argument)))}%`
        : /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(argument)
          ? `color:${argument}`
          : '';
    return ['span', { style }, 0];
  },
  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? { ...node, marks: [] }),
});
export const BBBlock = Node.create({
  name: 'bbBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { tag: { default: 'center' }, argument: { default: '' } };
  },
  renderHTML({ node }) {
    if (node.attrs.tag === 'spoiler')
      return [
        'details',
        { open: true },
        ['summary', {}, node.attrs.argument || 'Spoiler'],
        ['div', {}, 0],
      ];
    return ['div', { style: 'text-align:center' }, 0];
  },
  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? [], '\n\n'),
});
export const BBImage = Node.create({
  name: 'bbImage',
  markdownTokenName: 'image',
  parseMarkdown: (token) => ({
    type: 'bbImage',
    attrs: {
      src: typeof token.href === 'string' ? token.href : '',
      alt: typeof token.text === 'string' ? token.text : '',
    },
  }),
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { src: { default: '' }, alt: { default: '' } };
  },
  renderHTML({ node }) {
    return ['span', { class: 'bb-image-link' }, `Image: ${node.attrs.src}`];
  },
  renderMarkdown: (node) => {
    const href = safeTextHref(node.attrs?.src);
    return href
      ? `![${String(node.attrs?.alt ?? '')
          .replace(/\[/g, '\\[')
          .replace(/\]/g, '\\]')}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`
      : 'Image';
  },
});

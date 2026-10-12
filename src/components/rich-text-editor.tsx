'use client';
import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown as MarkdownExtension } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Link2,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Code2,
  Table2,
  Undo2,
  Redo2,
  Eye,
  Braces,
  PencilLine,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { FieldSelect } from './ui/field-select';
import { RichText } from './rich-text';
import { safeTextHref } from '@/lib/bbcode';
import { bbcodeToEditor, editorToBBCode } from '@/lib/editor-bbcode';
import type { TextFormat } from '@/lib/types';
import styles from './rich-text-editor.module.css';
import { BBStyle, BBBlock, BBImage } from './bbcode-editor-extensions';

type Props = {
  id: string;
  label: string;
  value: string;
  format: TextFormat;
  onChange: (value: string) => void;
  onFormatChange: (format: TextFormat) => void;
  disabled?: boolean;
  maxLength: number;
  describedBy?: string;
};
export function RichTextEditor(props: Props) {
  const t = useTranslations('richText');
  const [view, setView] = useState<'visual' | 'source' | 'preview'>('visual');
  const [, redraw] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [tooLong, setTooLong] = useState(false);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: false,
          isAllowedUri: (url) => Boolean(safeTextHref(url)),
          HTMLAttributes: { rel: 'noopener noreferrer nofollow ugc' },
        },
      }),
      MarkdownExtension,
      TableKit,
      BBStyle,
      BBBlock,
      BBImage,
      Placeholder.configure({ placeholder: t('placeholder') }),
    ],
    editorProps: {
      attributes: {
        id: props.id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': view === 'visual' ? props.label : '',
        'aria-describedby': props.describedBy ?? '',
      },
    },
    onUpdate: ({ editor }) => {
      const current = latest.current;
      const value =
        current.format === 'bbcode' ? editorToBBCode(editor.getJSON()) : editor.getMarkdown();
      if (Array.from(value).length > current.maxLength) {
        setTooLong(true);
        if (current.format === 'bbcode')
          editor.commands.setContent(bbcodeToEditor(current.value), { emitUpdate: false });
        else
          editor.commands.setContent(current.value, { contentType: 'markdown', emitUpdate: false });
        return;
      }
      setTooLong(false);
      current.onChange(value);
    },
    onSelectionUpdate: () => redraw((value) => value + 1),
    onTransaction: () => redraw((value) => value + 1),
  });
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.disabled, false);
    editor.setOptions({
      editorProps: {
        attributes: {
          id: props.id,
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': view === 'visual' ? props.label : '',
          'aria-describedby': props.describedBy ?? '',
        },
      },
    });
  }, [editor, props.disabled, props.id, props.label, props.describedBy, view]);
  useEffect(() => {
    if (!editor) return;
    const current =
      props.format === 'bbcode' ? editorToBBCode(editor.getJSON()) : editor.getMarkdown();
    if (current === props.value) return;
    if (props.format === 'bbcode')
      editor.commands.setContent(bbcodeToEditor(props.value), { emitUpdate: false });
    else editor.commands.setContent(props.value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, props.value, props.format]);
  function changeFormat(format: TextFormat) {
    if (!editor || props.disabled || format === props.format) return;
    const value = format === 'bbcode' ? editorToBBCode(editor.getJSON()) : editor.getMarkdown();
    if (Array.from(value).length > props.maxLength) {
      setTooLong(true);
      return;
    }
    props.onFormatChange(format);
    props.onChange(value);
    setTooLong(false);
  }
  const tools = editor
    ? [
        {
          name: 'bold',
          Icon: Bold,
          active: editor.isActive('bold'),
          run: () => editor.chain().focus().toggleBold().run(),
        },
        {
          name: 'italic',
          Icon: Italic,
          active: editor.isActive('italic'),
          run: () => editor.chain().focus().toggleItalic().run(),
        },
        {
          name: 'strike',
          Icon: Strikethrough,
          active: editor.isActive('strike'),
          run: () => editor.chain().focus().toggleStrike().run(),
        },
        ...(props.format === 'bbcode'
          ? [
              {
                name: 'underline',
                Icon: Underline,
                active: editor.isActive('underline'),
                run: () => editor.chain().focus().toggleUnderline().run(),
              },
            ]
          : []),
        {
          name: 'heading',
          Icon: Heading2,
          active: editor.isActive('heading'),
          run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          name: 'bulletList',
          Icon: List,
          active: editor.isActive('bulletList'),
          run: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
          name: 'orderedList',
          Icon: ListOrdered,
          active: editor.isActive('orderedList'),
          run: () => editor.chain().focus().toggleOrderedList().run(),
        },
        {
          name: 'quote',
          Icon: Quote,
          active: editor.isActive('blockquote'),
          run: () => editor.chain().focus().toggleBlockquote().run(),
        },
        {
          name: 'code',
          Icon: Code2,
          active: editor.isActive('codeBlock'),
          run: () => editor.chain().focus().toggleCodeBlock().run(),
        },
        {
          name: 'table',
          Icon: Table2,
          active: editor.isActive('table'),
          run: () =>
            editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(),
        },
        {
          name: 'undo',
          Icon: Undo2,
          active: false,
          run: () => editor.chain().focus().undo().run(),
        },
        {
          name: 'redo',
          Icon: Redo2,
          active: false,
          run: () => editor.chain().focus().redo().run(),
        },
      ]
    : [];
  return (
    <div className={styles.editor} data-editor-format={props.format}>
      <div className={styles.header}>
        <FieldSelect
          aria-label={t('format')}
          value={props.format}
          disabled={props.disabled || !editor}
          onValueChange={(value) => changeFormat(value as TextFormat)}
          options={[
            { value: 'markdown', label: 'Markdown' },
            { value: 'bbcode', label: 'BBCode' },
          ]}
        />
        <div className={styles.views} aria-label={t('mode')}>
          {(
            [
              { name: 'visual', Icon: PencilLine },
              { name: 'source', Icon: Braces },
              { name: 'preview', Icon: Eye },
            ] as const
          ).map(({ name, Icon }) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={view === name ? 'secondary' : 'ghost'}
              aria-pressed={view === name}
              onClick={() => setView(name)}
            >
              <Icon aria-hidden="true" />
              {t(name)}
            </Button>
          ))}
        </div>
      </div>
      {view === 'visual' && (
        <div className={styles.toolbar} role="group" aria-label={t('tools')}>
          {tools.map(({ name, Icon, active, run }) => (
            <Button
              key={name}
              type="button"
              size="icon"
              variant={active ? 'secondary' : 'ghost'}
              aria-label={t(name)}
              title={t(name)}
              aria-pressed={active}
              disabled={props.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={run}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
          <Button
            type="button"
            size="icon"
            variant={editor?.isActive('link') ? 'secondary' : 'ghost'}
            aria-label={t('link')}
            title={t('link')}
            disabled={props.disabled || !editor}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setLink(editor?.getAttributes('link').href ?? '');
              setLinkOpen(!linkOpen);
              setLinkError(false);
            }}
          >
            <Link2 aria-hidden="true" />
          </Button>
        </div>
      )}
      {linkOpen && view === 'visual' && (
        <div className={styles.link}>
          <Input
            aria-label={t('linkUrl')}
            value={link}
            disabled={props.disabled}
            placeholder="https://"
            onChange={(event) => {
              setLink(event.target.value);
              setLinkError(false);
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={props.disabled}
            onClick={() => {
              if (!editor) return;
              if (!link) editor.chain().focus().extendMarkRange('link').unsetLink().run();
              else if (safeTextHref(link))
                editor.chain().focus().extendMarkRange('link').setLink({ href: link }).run();
              else {
                setLinkError(true);
                return;
              }
              setLinkOpen(false);
            }}
          >
            {t('applyLink')}
          </Button>
          {linkError && (
            <p role="alert" className="form-error">
              {t('invalidLink')}
            </p>
          )}
        </div>
      )}
      <div hidden={view !== 'visual'} className={styles.canvas}>
        <EditorContent editor={editor} />
      </div>
      {view === 'source' && (
        <Textarea
          id={`${props.id}-source`}
          aria-label={props.label}
          aria-describedby={props.describedBy}
          value={props.value}
          disabled={props.disabled}
          maxLength={props.maxLength * 2}
          rows={8}
          onChange={(event) => {
            if (Array.from(event.target.value).length <= props.maxLength) {
              props.onChange(event.target.value);
              setTooLong(false);
            } else setTooLong(true);
          }}
        />
      )}
      {view === 'preview' && (
        <div className={styles.preview}>
          <RichText format={props.format}>{props.value}</RichText>
        </div>
      )}
      <div className={styles.footer}>
        <span>{t('stored', { format: props.format === 'bbcode' ? 'BBCode' : 'Markdown' })}</span>
        <span>
          {Array.from(props.value).length} / {props.maxLength}
        </span>
      </div>
      {tooLong && (
        <p className="form-error" role="alert">
          {t('tooLong')}
        </p>
      )}
    </div>
  );
}

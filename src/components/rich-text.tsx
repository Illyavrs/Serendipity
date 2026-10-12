import { Fragment, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Markdown } from './markdown';
import { parseBBCode, safeTextHref, type BBNode } from '@/lib/bbcode';
import type { TextFormat } from '@/lib/types';

export function RichText({
  children,
  format = 'markdown',
  className,
}: {
  children: string;
  format?: TextFormat;
  className?: string;
}) {
  const t = useTranslations('richText');
  if (format !== 'bbcode') return <Markdown className={className}>{children}</Markdown>;
  const render = (node: BBNode, key: number): ReactNode => {
    if (typeof node === 'string')
      return (
        <Fragment key={key}>
          {node.split('\n').map((line, index) => (
            <Fragment key={index}>
              {index > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </Fragment>
      );
    const content = node.children.map(render);
    switch (node.tag) {
      case 'b':
        return <strong key={key}>{content}</strong>;
      case 'i':
        return <em key={key}>{content}</em>;
      case 'u':
        return (
          <span key={key} style={{ textDecoration: 'underline' }}>
            {content}
          </span>
        );
      case 's':
      case 'strike':
        return <del key={key}>{content}</del>;
      case 'url': {
        const text = node.children.filter((child) => typeof child === 'string').join('');
        const href = safeTextHref(node.argument ?? text);
        return href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {content}
          </a>
        ) : (
          <span key={key}>{content}</span>
        );
      }
      case 'img': {
        const href = safeTextHref(node.children.join(''));
        return href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {t('imageLink')}
          </a>
        ) : (
          <span key={key}>{content}</span>
        );
      }
      case 'quote':
        return (
          <blockquote key={key}>
            {node.argument && <strong>{node.argument}</strong>}
            {content}
          </blockquote>
        );
      case 'code':
        return (
          <pre key={key}>
            <code>{content}</code>
          </pre>
        );
      case 'list':
        return node.argument === '1' ? <ol key={key}>{content}</ol> : <ul key={key}>{content}</ul>;
      case '*':
        return <li key={key}>{content}</li>;
      case 'hr':
        return <hr key={key} />;
      case 'br':
        return <br key={key} />;
      case 'h1':
        return <h1 key={key}>{content}</h1>;
      case 'h2':
        return <h2 key={key}>{content}</h2>;
      case 'h3':
        return <h3 key={key}>{content}</h3>;
      case 'table':
        return (
          <table key={key}>
            <tbody>
              {node.children
                .filter((child) => typeof child !== 'string' && child.tag === 'tr')
                .map(render)}
            </tbody>
          </table>
        );
      case 'tr':
        return (
          <tr key={key}>
            {node.children
              .filter((child) => typeof child !== 'string' && ['td', 'th'].includes(child.tag))
              .map(render)}
          </tr>
        );
      case 'td':
        return <td key={key}>{content}</td>;
      case 'th':
        return <th key={key}>{content}</th>;
      case 'spoiler':
        return (
          <details key={key}>
            <summary>{node.argument ?? t('spoiler')}</summary>
            {content}
          </details>
        );
      case 'center':
      case 'centre':
        return (
          <div key={key} style={{ textAlign: 'center' }}>
            {content}
          </div>
        );
      case 'color':
      case 'colour':
        return (
          <span
            key={key}
            style={{
              color: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(node.argument ?? '')
                ? node.argument
                : undefined,
            }}
          >
            {content}
          </span>
        );
      case 'size': {
        const size = /^\d{2,3}$/.test(node.argument ?? '')
          ? Math.max(75, Math.min(200, Number(node.argument)))
          : 100;
        return (
          <span key={key} style={{ fontSize: `${size}%` }}>
            {content}
          </span>
        );
      }
      default:
        return <Fragment key={key}>{content}</Fragment>;
    }
  };
  return (
    <div className={`user-markdown${className ? ` ${className}` : ''}`}>
      {parseBBCode(children).map(render)}
    </div>
  );
}

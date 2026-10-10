import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders player-written Markdown. Raw HTML is skipped, images are not loaded
 * (they would let an author track readers), and links open as untrusted user
 * content. `javascript:` and other unsafe protocols are removed by react-markdown.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`user-markdown${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        unwrapDisallowed
        components={{
          a: ({ href, children: label }: { href?: string; children?: ReactNode }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

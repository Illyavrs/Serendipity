'use client';
import { useState, useSyncExternalStore } from 'react';
import { NavigationLink as Link } from '@/components/navigation-motion';
import { useTranslations } from 'next-intl';
import { Copy, Check, ArrowRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/common';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const subscribe = () => () => {};
const currentDomain = () => window.location.hostname;
const fallbackDomain = () => 'your-server-domain';

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="connect-steps">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

export function ConnectPage({ downloadUrl }: { downloadUrl: string | null }) {
  const t = useTranslations('connect');
  const n = useTranslations('nav');
  const domain = useSyncExternalStore(subscribe, currentDomain, fallbackDomain);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const command = t('command', { domain });
  async function copy() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }
  const download = downloadUrl ? (
    <Button asChild>
      <a href={downloadUrl} rel="noopener noreferrer">
        <Download aria-hidden="true" />
        {t('download')}
      </a>
    </Button>
  ) : (
    <p className="hint">{t('downloadUnavailable')}</p>
  );
  return (
    <div className="page-container">
      <PageHeading title={t('title')} description={t('subtitle')} />
      <div className="guide-layout">
        <nav className="guide-sidebar" aria-label={t('guide')}>
          <a href="#account">{t('accountTitle')}</a>
          <a href="#client">{t('clientTitle')}</a>
          <a href="#help">{t('helpTitle')}</a>
        </nav>
        <article className="guide-body">
          <section id="account">
            <h2>{t('accountTitle')}</h2>
            <p>{t('accountText')}</p>
            <Button asChild>
              <Link href="/register">
                {n('join')}
                <ArrowRight />
              </Link>
            </Button>
          </section>
          <section id="client">
            <h2>{t('clientTitle')}</h2>
            <Tabs defaultValue="stable">
              <TabsList>
                <TabsTrigger value="stable">{t('stable')}</TabsTrigger>
                <TabsTrigger value="lazer">{t('lazer')}</TabsTrigger>
              </TabsList>
              <TabsContent value="stable" className="pt-6">
                <h3>{t('stableShortcutTitle')}</h3>
                <Steps items={t.raw('stableShortcutSteps') as string[]} />
                <div className="command">
                  <code>{command}</code>
                  <Button variant="ghost" size="icon" aria-label={t('copy')} onClick={copy}>
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
                {copied && (
                  <p className="form-success" role="status">
                    {t('copied')}
                  </p>
                )}
                {copyError && (
                  <p className="form-error" role="alert">
                    {t('copyError')}
                  </p>
                )}
                <p className="hint">{t('stableShortcutNote')}</p>
                <h3>{t('stableToolTitle')}</h3>
                <Steps items={t.raw('stableToolSteps') as string[]} />
                {download}
              </TabsContent>
              <TabsContent value="lazer" className="pt-6">
                <h3>{t('lazerTitle')}</h3>
                <Steps items={t.raw('lazerSteps') as string[]} />
                {download}
                <p className="hint">{t('lazerNote')}</p>
              </TabsContent>
            </Tabs>
          </section>
          <section id="help">
            <h2>{t('helpTitle')}</h2>
            <dl className="connect-help">
              {(t.raw('helpItems') as [string, string][]).map(([question, answer]) => (
                <div key={question}>
                  <dt>{question}</dt>
                  <dd>{answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        </article>
      </div>
    </div>
  );
}

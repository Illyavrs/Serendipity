import { ConnectPage } from '@/features/connect';

// The launcher download is operator-configured, so it is read per request.
export const dynamic = 'force-dynamic';

function downloadUrl() {
  const value = process.env.KALEIDOSCOPE_DOWNLOAD_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function Page() {
  return <ConnectPage downloadUrl={downloadUrl()} />;
}

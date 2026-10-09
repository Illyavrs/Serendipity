import { ApiError } from './api';
import type { OfficialBeatmapset } from './types';

export const MAX_OFFICIAL_ARCHIVE_BYTES = 64 * 1024 * 1024;

/** Only this server's exact archive routes can become a download target. */
export function officialArchiveDownloadUrl(set: OfficialBeatmapset): string | null {
  const id = set.official_set_id;
  if (!Number.isSafeInteger(id) || id <= 0 || id >= 2_000_000_000 || set.local.withdrawn)
    return null;
  const retained = set.local.archive_available
    ? set.difficulties.find(
        (map) =>
          map.archive_available && Number.isSafeInteger(map.local_id) && Number(map.local_id) > 0,
      )
    : undefined;
  // Retained packages keep their established access policy and need no provider.
  if (retained) return `/api/v1/beatmaps/${retained.local_id}/archive`;
  const expected = `/api/v1/official/beatmapsets/${id}/archive`;
  return !set.download_disabled &&
    set.archive_download_available === true &&
    set.archive_download_url === expected
    ? expected
    : null;
}

async function boundedBytes(response: Response, limit: number) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new ApiError(413, 'official_archive_too_large', 'The archive exceeds the limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, 'official_archive_invalid', 'The archive is empty.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new ApiError(413, 'official_archive_too_large', 'The archive exceeds the limit.');
      chunks.push(new Uint8Array(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return { chunks, size };
}

export async function readOfficialArchive(response: Response): Promise<Blob> {
  if (!response.ok) {
    let code = 'official_archive_provider_failed';
    try {
      const { chunks } = await boundedBytes(response, 8192);
      const body = JSON.parse(await new Blob(chunks).text());
      if (typeof body?.error?.code === 'string') code = body.error.code;
    } catch {
      // Unbounded, malformed and HTML error bodies never become download content.
    }
    throw new ApiError(response.status, code, `HTTP ${response.status}`);
  }
  if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/x-osu-archive') {
    await response.body?.cancel();
    throw new ApiError(502, 'official_archive_invalid', 'The response is not an archive.');
  }
  const { chunks, size } = await boundedBytes(response, MAX_OFFICIAL_ARCHIVE_BYTES);
  const blob = new Blob(chunks, { type: 'application/x-osu-archive' });
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (
    size < 4 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 3 ||
    signature[3] !== 4
  )
    throw new ApiError(502, 'official_archive_invalid', 'The response is not a ZIP archive.');
  // Full ZIP/member verification is performed by the server before any bytes are served.
  return blob;
}

export function archiveDownloadErrorKey(error: unknown) {
  if (!(error instanceof ApiError)) return 'archiveDownloadError';
  if (error.status === 401 || error.status === 403) return 'archiveDownloadUnauthorized';
  if (error.status === 404 || error.status === 410) return 'archiveDownloadWithdrawn';
  if (error.status === 429) return 'archiveDownloadLimited';
  if (error.status === 413 || error.code === 'official_archive_too_large')
    return 'archiveDownloadTooLarge';
  switch (error.code) {
    case 'official_archive_unavailable':
      return 'officialArchiveUnavailableHint';
    case 'official_archive_timeout':
      return 'archiveDownloadTimeout';
    case 'official_archive_invalid':
    case 'official_archive_manifest_mismatch':
    case 'official_archive_conflict':
      return 'archiveDownloadInvalid';
    default:
      return 'archiveDownloadError';
  }
}

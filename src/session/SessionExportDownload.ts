import type { SessionExportResult } from './SessionExporter.ts';
import type { RecordedSession } from './SessionRecorder.ts';

export interface SessionDownloadDescriptor {
  url: string;
  filename: string;
  mimeType: 'audio/wav' | 'audio/mpeg';
}

export interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface DownloadDocument {
  body: { appendChild(element: HTMLAnchorElement): unknown };
  createElement(tagName: 'a'): HTMLAnchorElement;
}

export function releaseSessionDownload(
  descriptor: SessionDownloadDescriptor | null,
  urlApi: ObjectUrlApi = URL,
): void {
  if (descriptor) urlApi.revokeObjectURL(descriptor.url);
}

export function createSessionExportFilename(session: RecordedSession, format: 'wav' | 'mp3'): string {
  const source = session.metadata.title?.trim() || session.sessionId;
  const safeName = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 72);
  return `system-dj-${safeName || 'session'}.${format}`;
}

export function createSessionDownload(
  result: SessionExportResult,
  session: RecordedSession,
  urlApi: ObjectUrlApi = URL,
): SessionDownloadDescriptor {
  const expectedMimeType = result.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  if (result.status !== 'completed' || result.mimeType !== expectedMimeType || result.blob.type !== expectedMimeType) {
    throw new Error('The completed export format and MIME type do not match.');
  }
  if (result.byteLength <= 0 || result.byteLength !== result.blob.size) {
    throw new Error('The completed export has an invalid file size.');
  }
  const url = urlApi.createObjectURL(result.blob);
  if (typeof url !== 'string' || url.length === 0) throw new Error('The browser did not create a download URL.');
  return {
    url,
    filename: createSessionExportFilename(session, result.format),
    mimeType: expectedMimeType,
  };
}

/** Starts a browser download; the visible fallback link remains available if this throws. */
export function initiateSessionDownload(
  descriptor: SessionDownloadDescriptor,
  documentApi: DownloadDocument = document,
): void {
  const anchor = documentApi.createElement('a');
  anchor.href = descriptor.url;
  anchor.download = descriptor.filename;
  anchor.hidden = true;
  documentApi.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

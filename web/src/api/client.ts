/**
 * API istemcisi.
 *
 * Onemli davranislar:
 *  - Hatalar ApiError olarak firlatilir; UI teknik detay gostermez, sunucudan
 *    gelen kullanici dostu mesaji gosterir.
 *  - 409 STALE_DATA / DUPLICATE_ACTION ozel olarak isaretlenir; ekran bunlari
 *    "veriyi yenile" akisina cevirir.
 *  - 401 durumunda oturum temizlenir.
 */

const TOKEN_KEY = 'hr.token';

export interface ApiFieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Kayit baska bir kullanici tarafindan degistirilmis. */
  get isStale(): boolean {
    return this.code === 'STALE_DATA';
  }

  /** Ayni islem daha once uygulanmis. */
  get isDuplicate(): boolean {
    return this.code === 'DUPLICATE_ACTION';
  }

  /** Form alan hatalari (varsa). */
  get fieldIssues(): ApiFieldIssue[] {
    const details = this.details as { fields?: ApiFieldIssue[] } | undefined;
    return details?.fields ?? [];
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage kapali olabilir; oturum yalnizca bu sekmede yasar */
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Cift gonderim korumasi icin. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError(401, 'UNAUTHENTICATED', 'Oturumunuz sona erdi. Yeniden giriş yapın.');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'Beklenmeyen bir hata oluştu.',
      error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

/** Dosya yukleme (multipart). */
export async function uploadFile(
  requestId: string,
  file: File,
): Promise<{ id: string; fileName: string }> {
  const form = new FormData();
  form.append('file', file);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/requests/${requestId}/attachments`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = 'Dosya yüklenemedi.';
    let code = 'INTERNAL_ERROR';
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; code?: string } };
      message = parsed.error?.message ?? message;
      code = parsed.error?.code ?? code;
    } catch {
      /* metin gövdesi */
    }
    throw new ApiError(res.status, code, message);
  }
  return res.json();
}

/** Yetkili dosya indirme (Authorization basligi gerektigi icin blob uzerinden). */
export async function downloadAttachment(attachmentId: string, fileName: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/requests/attachments/${attachmentId}/download`, { headers });
  if (!res.ok) {
    throw new ApiError(res.status, 'NOT_FOUND', 'Dosya indirilemedi veya erişim yetkiniz yok.');
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, fileName);
}

/** Rapor CSV indirme. */
export async function downloadReport(queryString: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api/catalog/reports/export?${queryString}`, { headers });
  if (!res.ok) {
    throw new ApiError(res.status, 'INTERNAL_ERROR', 'Rapor indirilemedi.');
  }
  const blob = await res.blob();
  const stamp = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `ik-talep-raporu-${stamp}.csv`);
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Query string olusturucu: bos degerleri atar. */
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else if (typeof value === 'boolean') {
      if (value) search.set(key, 'true');
    } else {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

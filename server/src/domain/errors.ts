/**
 * Uygulama hata tipleri.
 *
 * Kullaniciya asla stack trace donmez; her hata bir kod + insan okunur mesaj
 * tasir. Basarisiz islemler sessizce yutulmaz - her zaman bir AppError firlatilir.
 */

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE_DATA'
  | 'DUPLICATE_ACTION'
  | 'INVALID_TRANSITION'
  | 'WORKFLOW_CONFIG_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    httpStatus: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Oturum bulunamadi veya gecersiz.') {
    super('UNAUTHENTICATED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Bu islem icin yetkiniz yok.') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Kayit bulunamadi.') {
    super('NOT_FOUND', message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

/** Optimistic concurrency: ekrandaki veri bayat. */
export class StaleDataError extends AppError {
  constructor(
    message = 'Kayit siz goruntulerken baska bir kullanici tarafindan guncellendi. Lutfen sayfayi yenileyip tekrar deneyin.',
    details?: unknown,
  ) {
    super('STALE_DATA', message, 409, details);
  }
}

/** Ayni aksiyon ikinci kez gonderildi (or. cift tiklama). */
export class DuplicateActionError extends AppError {
  constructor(
    message = 'Bu islem daha once uygulanmis. Ikinci bir kayit olusturulmadi.',
    details?: unknown,
  ) {
    super('DUPLICATE_ACTION', message, 409, details);
  }
}

export class InvalidTransitionError extends AppError {
  constructor(message: string, details?: unknown) {
    super('INVALID_TRANSITION', message, 422, details);
  }
}

export class WorkflowConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('WORKFLOW_CONFIG_ERROR', message, 422, details);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

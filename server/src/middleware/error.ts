import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, isAppError } from '../domain/errors';
import { logger } from '../lib/logger';
import { env } from '../config/env';

/** Route handler'lari icin async hata yakalayici. */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req as T, res, next).catch(next);
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'İstenen kaynak bulunamadı.',
      path: req.originalUrl,
    },
  });
}

/**
 * Merkezi hata isleyici.
 * Kullaniciya asla stack trace veya SQL detayi donmez; teknik detay loglanir.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // 1) Bilinen uygulama hatalari
  if (isAppError(err)) {
    logIfServerSide(err, req);
    res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // 2) Girdi dogrulama (zod)
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Gönderilen bilgiler geçersiz.',
        details: {
          fields: err.issues.map((issue) => ({
            field: issue.path.join('.') || '(gövde)',
            message: issue.message,
          })),
        },
      },
    });
    return;
  }

  // 3) Prisma bilinen hatalari - teknik detay disari verilmez
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error({ err, code: err.code, path: req.originalUrl }, 'Veritabani hatasi');
    if (err.code === 'P2002') {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Bu kayıt zaten mevcut. Aynı bilgilerle ikinci bir kayıt oluşturulamaz.',
        },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'İşlem yapılacak kayıt bulunamadı.' },
      });
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Bu kayıt başka kayıtlarla ilişkili olduğu için işlem tamamlanamadı.',
        },
      });
      return;
    }
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Beklenmeyen bir veritabanı hatası oluştu.' },
    });
    return;
  }

  // 4) JSON parse hatasi
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as SyntaxError & { status?: number }).status === 400
  ) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'İstek gövdesi geçerli JSON değil.' },
    });
    return;
  }

  // 5) Beklenmeyen
  logger.error(
    { err, path: req.originalUrl, method: req.method, userId: req.auth?.id },
    'Beklenmeyen sunucu hatasi',
  );
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Beklenmeyen bir hata oluştu. Sorun devam ederse sistem yöneticisine bildirin.',
      ...(env.isProduction ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
}

function logIfServerSide(err: AppError, req: Request): void {
  if (err.httpStatus >= 500) {
    logger.error({ err, path: req.originalUrl }, 'Sunucu tarafli uygulama hatasi');
  } else {
    logger.debug(
      { code: err.code, path: req.originalUrl, userId: req.auth?.id },
      err.message,
    );
  }
}

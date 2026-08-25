/**
 * Minimal yapisal logger. Harici bagimlilik eklemeye gerek yok.
 * Kullaniciya asla stack trace donmez; hatalar burada loglanir.
 */

import { env } from '../config/env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVEL_ORDER[(env.logLevel as Level) in LEVEL_ORDER ? (env.logLevel as Level) : 'info'];

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      ...(env.isProduction ? {} : { stack: err.stack }),
    };
  }
  return err;
}

function emit(level: Level, context: unknown, message: string): void {
  if (LEVEL_ORDER[level] < threshold) return;

  const payload: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    message,
  };

  if (context && typeof context === 'object') {
    for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
      payload[key] = key === 'err' ? serializeError(value) : value;
    }
  } else if (context !== undefined) {
    payload.context = context;
  }

  const line = JSON.stringify(payload);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function make(level: Level) {
  return (contextOrMessage: unknown, maybeMessage?: string): void => {
    if (typeof contextOrMessage === 'string') {
      emit(level, undefined, contextOrMessage);
    } else {
      emit(level, contextOrMessage, maybeMessage ?? '');
    }
  };
}

export const logger = {
  debug: make('debug'),
  info: make('info'),
  warn: make('warn'),
  error: make('error'),
};

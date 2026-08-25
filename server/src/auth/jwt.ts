import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthenticatedError } from '../domain/errors';

export interface TokenPayload {
  /** User.id */
  sub: string;
  username: string;
}

export function signAccessToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.jwt.expiresIn as SignOptions['expiresIn'],
    issuer: env.jwt.issuer,
  };
  return jwt.sign(payload, env.jwt.secret, options);
}

export function verifyAccessToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.jwt.secret, { issuer: env.jwt.issuer });
    if (typeof decoded === 'string' || !decoded || typeof decoded.sub !== 'string') {
      throw new UnauthenticatedError('Gecersiz oturum belirteci.');
    }
    return {
      sub: decoded.sub,
      username: typeof decoded.username === 'string' ? decoded.username : '',
    };
  } catch (err) {
    if (err instanceof UnauthenticatedError) throw err;
    throw new UnauthenticatedError('Oturum suresi dolmus veya belirtec gecersiz.');
  }
}

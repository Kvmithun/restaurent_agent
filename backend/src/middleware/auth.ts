import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export type Role = 'USER' | 'RESTAURANT' | 'DELIVERY_PARTNER';
export interface AuthRequest extends Request { auth?: { subject: string; role: Role } }

export function authenticateJWT(request: AuthRequest, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  try {
    const claims = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    if (typeof claims.sub !== 'string' || !['USER', 'RESTAURANT', 'DELIVERY_PARTNER'].includes(String(claims.role))) throw new Error('Invalid claims');
    request.auth = { subject: claims.sub, role: claims.role as Role };
    return next();
  } catch {
    return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired' } });
  }
}

export function requireRole(...roles: Role[]) {
  return (request: AuthRequest, response: Response, next: NextFunction) => {
    if (!request.auth || !roles.includes(request.auth.role)) return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    return next();
  };
}

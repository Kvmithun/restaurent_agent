import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { login, register } from '../services/auth.js';

export const authRouter = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' } } });
authRouter.use(authLimiter);
authRouter.post('/register', async (request, response, next) => {
  try { response.status(201).json(await register(request.body)); } catch (error) { next(error); }
});
authRouter.post('/login', async (request, response, next) => {
  try { response.json(await login(request.body)); } catch (error) { next(error); }
});

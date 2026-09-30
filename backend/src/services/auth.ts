import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { DeliveryPartner, Restaurant, User } from '../models/index.js';
import type { Role } from '../middleware/auth.js';
import { geocodeAddress } from './geo.js';

const common = { name: z.string().min(1).max(100), email: z.string().email().max(254), phone: z.string().min(7).max(24), password: z.string().min(10).max(128), address: z.string().min(3).max(300) };
const signupSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('USER'), ...common }),
  z.object({ role: z.literal('RESTAURANT'), ...common, restaurantName: z.string().min(1).max(120), ownerName: z.string().min(1).max(100), fssaiNumber: z.string().optional() }),
  z.object({ role: z.literal('DELIVERY_PARTNER'), ...common, vehicleType: z.string().min(1), vehicleNumber: z.string().min(1) }),
]);
const modelByRole = { USER: User, RESTAURANT: Restaurant, DELIVERY_PARTNER: DeliveryPartner } as const;

export async function register(input: unknown) {
  const data = signupSchema.parse(input);
  const { role, password, ...profile } = data;
  const Model = modelByRole[role];
  const addressLocation = await geocodeAddress(profile.address, role === 'RESTAURANT' ? (profile as any).restaurantName : undefined).then((result) => result?.point).catch(() => undefined);
  const demoApproval = process.env.NODE_ENV !== 'production' && role !== 'USER';
  const created = await Model.create({ ...profile, ...(addressLocation ? { location: addressLocation } : {}), ...(demoApproval ? { status: 'ACTIVE', ...(role === 'RESTAURANT' ? { isVerified: true } : {}) } : {}), passwordHash: await bcrypt.hash(password, 12) });
  return issueToken(created.id, role);
}

export async function login(input: unknown) {
  const data = z.object({ role: z.enum(['USER', 'RESTAURANT', 'DELIVERY_PARTNER']), email: z.string().email(), password: z.string().min(1) }).parse(input);
  const Model = modelByRole[data.role];
  const account = await Model.findOne({ email: data.email.toLowerCase() }).select('+passwordHash');
  if (!account || !await bcrypt.compare(data.password, account.passwordHash)) throw Object.assign(new Error('Email or password is incorrect'), { status: 401, code: 'INVALID_CREDENTIALS' });
  if (account.status === 'SUSPENDED') throw Object.assign(new Error('Account is suspended'), { status: 403, code: 'ACCOUNT_SUSPENDED' });
  if (process.env.NODE_ENV !== 'production' && data.role !== 'USER' && account.status === 'PENDING') {
    account.status = 'ACTIVE';
    if (data.role === 'RESTAURANT') (account as typeof account & { isVerified?: boolean }).isVerified = true;
    await account.save();
  }
  return issueToken(account.id, data.role);
}

function issueToken(subject: string, role: Role) {
  const token = jwt.sign({ role }, env.JWT_SECRET, { subject, expiresIn: '12h', issuer: 'restaurant-platform', audience: 'restaurant-platform-client' });
  return { token, tokenType: 'Bearer', expiresIn: 43200, user: { id: subject, role } };
}

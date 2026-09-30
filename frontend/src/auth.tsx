import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, type Account, type AuthPayload, getToken } from './api';

interface AuthContextValue { user: Account | null; signIn: (role: Account['role'], email: string, password: string) => Promise<void>; signUp: (values: Record<string, string>) => Promise<void>; signOut: () => void }
const Context = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null>(() => {
    if (!getToken()) return null;
    try { return JSON.parse(localStorage.getItem('restaurant-user') ?? 'null') as Account | null; } catch { return null; }
  });
  async function persist(payload: AuthPayload) { localStorage.setItem('restaurant-token', payload.token); localStorage.setItem('restaurant-user', JSON.stringify(payload.user)); setUser(payload.user); }
  async function signIn(role: Account['role'], email: string, password: string) { await persist(await api<AuthPayload>('/auth/login', { method: 'POST', body: JSON.stringify({ role, email, password }) })); }
  async function signUp(values: Record<string, string>) { await persist(await api<AuthPayload>('/auth/register', { method: 'POST', body: JSON.stringify(values) })); }
  function signOut() { localStorage.removeItem('restaurant-token'); localStorage.removeItem('restaurant-user'); setUser(null); }
  const value = useMemo(() => ({ user, signIn, signUp, signOut }), [user]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth() { const context = useContext(Context); if (!context) throw new Error('AuthProvider is missing'); return context; }

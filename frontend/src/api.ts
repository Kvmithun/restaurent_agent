export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';
export interface Account { id: string; role: 'USER' | 'RESTAURANT' | 'DELIVERY_PARTNER' }
export interface AuthPayload { token: string; tokenType: string; expiresIn: number; user: Account }
export function getToken() { return localStorage.getItem('restaurant-token'); }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  return data as T;
}

export async function uploadFile<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set('file', file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await fetch(`${API_URL}${path}`, { method: 'POST', headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {}, body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? `Upload failed (${response.status})`);
  return data as T;
}

export async function streamChat(message: string, sessionId: string | undefined, onToken: (token: string) => void, onReplace?: (message: string) => void): Promise<{ sessionId: string }> {
  const response = await fetch(`${API_URL}/ai/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ message, sessionId }) });
  if (!response.ok || !response.body) { const error = await response.json().catch(() => ({})); throw new Error(error?.error?.message ?? 'Could not connect to the assistant'); }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', result: { sessionId: string } | null = null;
  function consume(block: string) {
    const eventName = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
    const dataLine = block.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
    if (!eventName || !dataLine) return;
    const data = JSON.parse(dataLine);
    if (eventName === 'token') onToken(String(data.token ?? ''));
    if (eventName === 'replace') onReplace?.(String(data.message ?? ''));
    if (eventName === 'done') result = { sessionId: data.sessionId };
    if (eventName === 'error') throw new Error(data.message ?? 'Assistant request failed');
  }
  while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const blocks = buffer.split('\n\n'); buffer = blocks.pop() ?? ''; for (const block of blocks) consume(block); }
  if (buffer.trim()) consume(buffer);
  if (!result) throw new Error('Assistant stream ended before completion');
  return result;
}

import axios from 'axios';
export type User = { id: string; name: string; email: string; avatarUrl?: string | null };
export type Email = { id: string; recipient: string; subject: string; scheduledAt: string; sentAt?: string | null; status: string; errorMessage?: string | null };
export type Sender = { id: string; email: string; displayName?: string | null };
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000', withCredentials: true });
export const authApi = { me: () => api.get<{ user: User | null }>('/api/auth/me'), logout: () => api.post('/api/auth/logout') };
export const emailApi = { list: (kind: 'scheduled' | 'sent' | 'failed') => api.get<{ items: Email[]; total: number }>(`/api/emails/${kind}`), search: (q: string) => api.get<{ items: Email[] }>('/api/emails/search', { params: { q } }), schedule: (payload: unknown) => api.post('/api/emails/schedule', payload) };
export const senderApi = { list: () => api.get<Sender[]>('/api/senders') };
export const slackApi = { status: () => api.get<{ connected: boolean }>('/api/slack/status'), disconnect: () => api.post('/api/slack/disconnect') };

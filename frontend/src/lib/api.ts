const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────────
  login: (data: { supabaseToken?: string; email?: string; password?: string }) =>
    request<{ token: string; workspace: Workspace }>('/api/auth/workspace-token', {
      method: 'POST', body: JSON.stringify(data),
    }),
  register: (data: { name?: string; email: string; password: string }) =>
    request<{ token: string; workspace: Workspace }>('/api/auth/register', {
      method: 'POST', body: JSON.stringify(data),
    }),
  getMe: () => request<{ userId: string; email: string; workspace: Workspace }>('/api/auth/me'),
  getApiKeys: () => request<ApiKey[]>('/api/auth/api-keys'),
  createApiKey: (name: string) =>
    request<ApiKey & { key: string }>('/api/auth/api-keys', {
      method: 'POST', body: JSON.stringify({ name }),
    }),
  deleteApiKey: (id: string) =>
    request<{ success: boolean }>(`/api/auth/api-keys/${id}`, { method: 'DELETE' }),

  // ── Agents (Assistants) ─────────────────────────────────────────────────────
  getAssistants: () => request<Agent[]>('/api/assistants'),
  getAssistant:  (id: string) => request<Agent>(`/api/assistants/${id}`),
  createAssistant: (data: Partial<Agent> | Record<string, unknown>) =>
    request<Agent>('/api/assistants', { method: 'POST', body: JSON.stringify(data) }),
  updateAssistant: (id: string, data: Partial<Agent> | Record<string, unknown>) =>
    request<Agent>(`/api/assistants/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAssistant: (id: string) =>
    request<{ success: boolean }>(`/api/assistants/${id}`, { method: 'DELETE' }),

  // ── Calls ───────────────────────────────────────────────────────────────────
  getCalls: (params?: { page?: number; limit?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.page)   q.set('page',   String(params.page));
    if (params?.limit)  q.set('limit',  String(params.limit));
    if (params?.status) q.set('status', params.status);
    return request<CallsResponse>(`/api/calls?${q}`);
  },
  getCall: (id: string) => request<Call>(`/api/calls/${id}`),
  createCall: (data: { agentId?: string; assistantId?: string; toNumber: string; fromNumber?: string }) =>
    request<Call>('/api/calls', { method: 'POST', body: JSON.stringify(data) }),
  hangupCall: (id: string) =>
    request<{ success: boolean }>(`/api/calls/${id}`, { method: 'DELETE' }),

  // ── Phone Numbers ───────────────────────────────────────────────────────────
  getPhoneNumbers: () => request<PhoneNumber[]>('/api/phone-numbers'),
  getAvailableNumbers: (countryCode = 'IN') =>
    request<AvailableNumber[]>(`/api/phone-numbers/available?countryCode=${countryCode}`),
  purchasePhoneNumber: (number: string) =>
    request<PhoneNumber>('/api/phone-numbers', { method: 'POST', body: JSON.stringify({ number }) }),
  assignAssistant: (id: string, agentId: string | null) =>
    request<PhoneNumber>(`/api/phone-numbers/${id}`, {
      method: 'PATCH', body: JSON.stringify({ agentId }),
    }),
  assignAgent: (id: string, agentId: string | null) =>
    request<PhoneNumber>(`/api/phone-numbers/${id}`, {
      method: 'PATCH', body: JSON.stringify({ agentId }),
    }),
  releasePhoneNumber: (id: string) =>
    request<{ success: boolean }>(`/api/phone-numbers/${id}`, { method: 'DELETE' }),

  // ── Bookings ────────────────────────────────────────────────────────────────
  getBookings: (params?: { date?: string; agentId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.date)    q.set('date',    params.date);
    if (params?.agentId) q.set('agentId', params.agentId);
    if (params?.status)  q.set('status',  params.status);
    return request<{ bookings: Booking[]; total: number }>(`/api/bookings?${q}`);
  },
  getBooking: (id: string) => request<Booking>(`/api/bookings/${id}`),
  updateBooking: (id: string, data: { status?: string; appointmentDate?: string; appointmentTime?: string; notes?: string }) =>
    request<Booking>(`/api/bookings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  exportBookingsCsv: (params?: { date?: string; agentId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.date)    q.set('date',    params.date!);
    if (params?.agentId) q.set('agentId', params.agentId!);
    if (params?.status)  q.set('status',  params.status!);
    const token = getToken();
    if (token) q.set('token', token);
    return `${API_URL}/api/bookings/export/csv?${q}`;
  },

  // ── Campaigns ───────────────────────────────────────────────────────────────
  getCampaigns: () => request<{ campaigns: Campaign[]; total: number }>('/api/campaigns'),
  getCampaign:  (id: string) => request<Campaign>(`/api/campaigns/${id}`),
  createCampaign: (data: Partial<Campaign>) =>
    request<Campaign>('/api/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  updateCampaign: (id: string, data: Partial<Campaign>) =>
    request<Campaign>(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCampaign: (id: string) =>
    request<{ deleted: boolean }>(`/api/campaigns/${id}`, { method: 'DELETE' }),
  startCampaign:  (id: string) => request<{ started: boolean; enqueuedCalls: number }>(`/api/campaigns/${id}/start`, { method: 'POST' }),
  pauseCampaign:  (id: string) => request<{ paused: boolean }>(`/api/campaigns/${id}/pause`, { method: 'POST' }),
  stopCampaign:   (id: string) => request<{ stopped: boolean }>(`/api/campaigns/${id}/stop`, { method: 'POST' }),

  // ── Contact Lists ───────────────────────────────────────────────────────────
  getContactLists: () => request<{ contactLists: ContactList[]; total: number }>('/api/contact-lists'),
  getContactList:  (id: string) => request<ContactList>(`/api/contact-lists/${id}`),
  createContactList: (name: string) =>
    request<ContactList>('/api/contact-lists', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteContactList: (id: string) =>
    request<{ deleted: boolean }>(`/api/contact-lists/${id}`, { method: 'DELETE' }),
  bulkUploadContacts: (listId: string, contacts: { phoneNumber: string; name?: string; email?: string }[]) =>
    request<{ inserted: number; total: number }>(`/api/contact-lists/${listId}/contacts/bulk`, {
      method: 'POST', body: JSON.stringify({ contacts }),
    }),

  // ── Knowledge Bases ─────────────────────────────────────────────────────────
  getKnowledgeBases: () => request<{ knowledgeBases: KnowledgeBase[]; total: number }>('/api/knowledge-bases'),
  getKnowledgeBase:  (id: string) => request<KnowledgeBase>(`/api/knowledge-bases/${id}`),
  createKnowledgeBase: (data: { name: string; description?: string }) =>
    request<KnowledgeBase>('/api/knowledge-bases', { method: 'POST', body: JSON.stringify(data) }),
  deleteKnowledgeBase: (id: string) =>
    request<{ deleted: boolean }>(`/api/knowledge-bases/${id}`, { method: 'DELETE' }),
  addKbDocument: (kbId: string, data: { filename: string; content: string }) =>
    request<{ documentId: string; chunkCount: number }>(`/api/knowledge-bases/${kbId}/documents`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  deleteKbDocument: (kbId: string, docId: string) =>
    request<{ deleted: boolean }>(`/api/knowledge-bases/${kbId}/documents/${docId}`, { method: 'DELETE' }),
  assignKbToAgent: (kbId: string, agentId: string) =>
    request<unknown>(`/api/knowledge-bases/${kbId}/assign`, {
      method: 'POST', body: JSON.stringify({ agentId }),
    }),
  removeKbFromAgent: (kbId: string, agentId: string) =>
    request<unknown>(`/api/knowledge-bases/${kbId}/assign/${agentId}`, { method: 'DELETE' }),

  // ── Webhooks ────────────────────────────────────────────────────────────────
  getWebhooks: () => request<{ webhooks: WebhookEndpoint[]; total: number }>('/api/webhooks'),
  createWebhook: (data: { url: string; events: string[] }) =>
    request<WebhookEndpoint & { secret: string }>('/api/webhooks', {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateWebhook: (id: string, data: { isActive?: boolean; url?: string; events?: string[] }) =>
    request<WebhookEndpoint>(`/api/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteWebhook: (id: string) =>
    request<{ deleted: boolean }>(`/api/webhooks/${id}`, { method: 'DELETE' }),
  getWebhookDeliveries: (id: string) =>
    request<{ deliveries: WebhookDelivery[] }>(`/api/webhooks/${id}/deliveries`),
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  creditsBalance: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key?: string;
  keyPrefix?: string;
  lastUsed?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  language?: string;
  status?: string;
  systemPrompt: string;
  greetingMessage?: string;
  firstMessage?: string;
  llmModel: string;
  llmTemperature?: number;
  llmMaxTokens?: number;
  sttLanguage?: string;
  sttModel?: string;
  ttsVoice?: string;
  ttsVoiceId?: string;
  ttsModel?: string;
  ttsStability?: number;
  ttsSimilarity?: number;
  ttsSpeed?: number;
  maxDurationMinutes?: number;
  maxCallDuration?: number;
  silenceTimeoutSeconds?: number;
  transferNumber?: string;
  endCallMessage?: string;
  endCallPhrases?: string[];
  webhookUrl?: string;
  enableBooking: boolean;
  createdAt: string;
  updatedAt: string;
}

// keep old name as alias for existing code
export type Assistant = Agent;

export interface Call {
  id: string;
  agentId?: string;
  agent?: { id: string; name: string };
  assistant?: { id: string; name: string };
  direction: string;
  type: string;
  status: string;
  outcome?: string;
  phoneNumber: string;
  fromNumber?: string;
  toNumber?: string;
  durationSeconds: number;
  duration?: number;
  costRupees: number;
  bookingConfirmed: boolean;
  transcript: string;
  messages?: CallMessage[];
  startedAt?: string;
  createdAt: string;
  endedAt?: string;
}

export interface CallMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  timestamp?: string;
  createdAt: string;
}

export interface CallsResponse {
  calls: Call[];
  total: number;
  page: number;
  totalPages: number;
}

export interface PhoneNumber {
  id: string;
  number: string;
  friendlyName?: string;
  provider: string;
  agentId?: string;
  assistantId?: string;
  agent?: { id: string; name: string };
  assistant?: { id: string; name: string };
  isActive: boolean;
  createdAt: string;
}

export interface AvailableNumber {
  number: string;
  country: string;
  type: string;
  monthly_rental_rate: string;
}

export interface Booking {
  id: string;
  workspaceId: string;
  agentId?: string;
  agent?: { id: string; name: string };
  callId?: string;
  patientName: string;
  patientPhone: string;
  appointmentDate: string;
  appointmentTime: string;
  notes: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: string;
  agentId?: string;
  agent?: { id: string; name: string };
  contactListId?: string;
  scheduledAt?: string;
  totalContacts: number;
  calledContacts: number;
  successfulCalls: number;
  failedCalls: number;
  maxConcurrent: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactList {
  id: string;
  name: string;
  contactCount: number;
  contacts?: Contact[];
  createdAt: string;
}

export interface Contact {
  id: string;
  phoneNumber: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  documentCount: number;
  assignedAgentCount: number;
  documents?: KbDocument[];
  createdAt: string;
}

export interface KbDocument {
  id: string;
  filename: string;
  chunkCount: number;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  createdAt: string;
}

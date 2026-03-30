const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Auth
  register: (data: { email: string; password: string; name?: string }) =>
    request<{ user: User; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: () => request<User>('/api/auth/me'),

  getApiKeys: () => request<ApiKey[]>('/api/auth/api-keys'),
  createApiKey: (name: string) =>
    request<ApiKey>('/api/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  deleteApiKey: (id: string) =>
    request<{ success: boolean }>(`/api/auth/api-keys/${id}`, {
      method: 'DELETE',
    }),

  // Assistants
  getAssistants: () => request<Assistant[]>('/api/assistants'),
  getAssistant: (id: string) => request<Assistant>(`/api/assistants/${id}`),
  createAssistant: (data: Partial<Assistant>) =>
    request<Assistant>('/api/assistants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAssistant: (id: string, data: Partial<Assistant>) =>
    request<Assistant>(`/api/assistants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteAssistant: (id: string) =>
    request<{ success: boolean }>(`/api/assistants/${id}`, {
      method: 'DELETE',
    }),

  // Calls
  getCalls: (params?: { page?: number; limit?: number; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    return request<CallsResponse>(`/api/calls?${query}`);
  },
  getCall: (id: string) => request<Call>(`/api/calls/${id}`),
  createCall: (data: { assistantId: string; toNumber: string; fromNumber?: string }) =>
    request<Call>('/api/calls', { method: 'POST', body: JSON.stringify(data) }),
  hangupCall: (id: string) =>
    request<{ success: boolean }>(`/api/calls/${id}`, { method: 'DELETE' }),

  // Phone Numbers
  getPhoneNumbers: () => request<PhoneNumber[]>('/api/phone-numbers'),
  getAvailableNumbers: (areaCode?: string) =>
    request<AvailableNumber[]>(
      `/api/phone-numbers/available${areaCode ? `?areaCode=${areaCode}` : ''}`
    ),
  purchasePhoneNumber: (areaCode?: string) =>
    request<PhoneNumber>('/api/phone-numbers', {
      method: 'POST',
      body: JSON.stringify({ areaCode }),
    }),
  assignAssistant: (id: string, assistantId: string | null) =>
    request<PhoneNumber>(`/api/phone-numbers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ assistantId }),
    }),
  releasePhoneNumber: (id: string) =>
    request<{ success: boolean }>(`/api/phone-numbers/${id}`, {
      method: 'DELETE',
    }),
};

// Types
export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  lastUsed?: string;
  createdAt: string;
}

export interface Assistant {
  id: string;
  name: string;
  systemPrompt: string;
  firstMessage?: string;
  llmProvider: string;
  llmModel: string;
  llmTemperature: number;
  llmMaxTokens: number;
  sttProvider: string;
  sttLanguage: string;
  sttModel: string;
  ttsProvider: string;
  ttsVoiceId: string;
  ttsModel: string;
  ttsStability: number;
  ttsSimilarity: number;
  ttsSpeed: number;
  endCallMessage?: string;
  endCallPhrases: string[];
  maxCallDuration: number;
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Call {
  id: string;
  assistantId: string;
  assistant?: { id: string; name: string };
  phoneNumberId?: string;
  phoneNumber?: { id: string; number: string; friendlyName?: string };
  type: 'INBOUND' | 'OUTBOUND' | 'WEB';
  status: 'QUEUED' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'BUSY' | 'NO_ANSWER' | 'CANCELED';
  toNumber?: string;
  fromNumber?: string;
  startedAt?: string;
  endedAt?: string;
  duration?: number;
  messages?: CallMessage[];
  createdAt: string;
}

export interface CallMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  timestamp: string;
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
  assistantId?: string;
  assistant?: { id: string; name: string };
  createdAt: string;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  region: string;
  locality: string;
}

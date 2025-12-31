/**
 * API client for Documind.ai backend
 */
import axios, { AxiosError } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor
api.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
        try {
            const rawStorage = localStorage.getItem('autophile-auth');
            if (rawStorage) {
                const storage = JSON.parse(rawStorage);
                const token = storage.state?.token;
                console.log('API Interceptor - Token found:', token ? 'YES' : 'NO');
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`;
                }
            }
        } catch (e) {
            console.error('API Interceptor error:', e);
        }
    }
    return config;
});

// Response interceptor
api.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
        if (error.response?.status === 401) {
            // Dispatch logout event or clear storage
            // We can't import store here easily if store imports api.
            if (typeof window !== 'undefined') {
                // We rely on component level checks or just let it fail
            }
        }
        return Promise.reject(error);
    }
);

// Types
export interface User {
    id: number;
    email: string;
    name: string;
    role: string;
    picture?: string;
    workspace_id: number;
}

export interface Document {
    id: number;
    filename: string;
    original_filename: string;
    file_size: number;
    page_count: number | null;
    status: 'uploaded' | 'processing' | 'ready' | 'failed';
    tags: Record<string, string> | null;
    created_at: string;
    processed_at: string | null;
}

export interface Citation {
    page: number;
    text: string;
    chunk_id: number;
    section: string | null;
}

export interface ChatMessage {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    citations: Citation[] | null;
    created_at: string;
}

export interface ChatResponse {
    session_id: number;
    message_id: number;
    content: string;
    citations: Citation[];
}

export interface Annotation {
    id: number;
    document_id: number;
    user_id: number;
    annotation_type: string;
    page_number: number;
    bbox: any;
    selected_text?: string;
    note?: string;
    color: string;
    is_shared: boolean;
    created_at: string;
}

export interface AnnotationCreate {
    document_id: number;
    annotation_type: string;
    page_number: number;
    bbox: any;
    selected_text?: string;
    note?: string;
    color?: string;
    is_shared?: boolean;
}

// Document API
export const documentApi = {
    async upload(file: File): Promise<Document> {
        const formData = new FormData();
        formData.append('file', file);

        const response = await api.post('/api/documents/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    },

    async list(skip = 0, limit = 20, search?: string, ids?: number[]): Promise<{ documents: Document[]; total: number }> {
        const params = new URLSearchParams();
        params.set('skip', skip.toString());
        params.set('limit', limit.toString());
        if (search) params.set('search', search);
        if (ids && ids.length > 0) {
            ids.forEach(id => params.append('ids', id.toString()));
        }

        const response = await api.get(`/api/documents/?${params}`);
        return response.data;
    },

    async get(id: number): Promise<Document> {
        const response = await api.get(`/api/documents/${id}`);
        return response.data;
    },

    async delete(id: number): Promise<void> {
        await api.delete(`/api/documents/${id}`);
    },

    getPdfUrl(id: number): string {
        return `${API_BASE_URL}/api/documents/${id}/pdf`;
    },

    async claim(ids: number[]) {
        await api.post('/api/documents/claim', { document_ids: ids });
    },
};

// Auth API
export const authApi = {
    login: async (formData: FormData) => {
        // OAuth2 password grant expects application/x-www-form-urlencoded
        const params = new URLSearchParams();
        params.append('username', formData.get('username') as string);
        params.append('password', formData.get('password') as string);

        const { data } = await api.post<{ access_token: string }>('/api/auth/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return data;
    },
    register: async (userData: { email: string; password: string; name: string }) => {
        const { data } = await api.post<User>('/api/auth/register', userData);
        return data;
    },
    googleLogin: async (token: string) => {
        const { data } = await api.post<{ access_token: string }>('/api/auth/google', { token });
        return data;
    },
    getMe: async () => {
        const { data } = await api.get<User>('/api/auth/me');
        return data;
    }
};

export const handleApiError = (error: any) => {
    if (axios.isAxiosError(error)) {
        return error.response?.data?.detail || error.message || 'An error occurred';
    }
    return (error as Error).message || 'An unexpected error occurred';
};

// Chat API
export const chatApi = {
    async send(documentId: number, message: string, sessionId?: number): Promise<ChatResponse> {
        const response = await api.post('/api/chat/', {
            document_id: documentId,
            message,
            session_id: sessionId,
        });
        return response.data;
    },

    async *stream(documentId: number, message: string, sessionId: number | null, signal?: AbortSignal): AsyncGenerator<any, void, unknown> {
        const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                document_id: documentId,
                message,
                session_id: sessionId,
            }),
            signal,
        });

        if (!response.body) {
            throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') return;
                    try {
                        yield JSON.parse(data);
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        }
    },

    async getHistory(sessionId: number): Promise<{ session_id: number; document_id: number; messages: ChatMessage[] }> {
        const response = await api.get(`/api/chat/history/${sessionId}`);
        return response.data;
    },

    async listSessions(documentId: number): Promise<{ id: number; title: string; created_at: string }[]> {
        const response = await api.get(`/api/chat/sessions/${documentId}`);
        return response.data;
    },

    async deleteSession(sessionId: number): Promise<void> {
        await api.delete(`/api/chat/sessions/${sessionId}`);
    },
};

// Annotation API
export const annotationApi = {
    async list(documentId: number): Promise<Annotation[]> {
        const response = await api.get(`/api/annotations/${documentId}`);
        return response.data;
    },

    async create(data: AnnotationCreate): Promise<Annotation> {
        const response = await api.post('/api/annotations/', data);
        return response.data;
    },

    async update(id: number, data: Partial<AnnotationCreate>): Promise<Annotation> {
        const response = await api.put(`/api/annotations/${id}`, data);
        return response.data;
    },

    async delete(id: number): Promise<void> {
        await api.delete(`/api/annotations/${id}`);
    },
};

// Error handling helper
export function getErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
        return error.response?.data?.detail || error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'An unexpected error occurred';
}

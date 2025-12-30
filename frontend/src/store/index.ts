/**
 * Zustand store for application state
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Document, Citation } from '@/lib/api';

interface AppState {
    // Current document
    currentDocument: Document | null;
    setCurrentDocument: (doc: Document | null) => void;

    // PDF viewer state
    currentPage: number;
    setCurrentPage: (page: number) => void;
    zoom: number;
    setZoom: (zoom: number) => void;

    // Active citation highlight
    activeCitation: Citation | null;
    setActiveCitation: (citation: Citation | null) => void;

    // Chat state
    chatSessionId: number | null;
    setChatSessionId: (id: number | null) => void;
    isChatOpen: boolean;
    toggleChat: () => void;

    // Document library
    documents: Document[];
    setDocuments: (docs: Document[]) => void;
    addDocument: (doc: Document) => void;
    updateDocument: (id: number, updates: Partial<Document>) => void;
    removeDocument: (id: number) => void;

    // Guest
    guestDocIds: number[];
    addGuestDocId: (id: number) => void;
    clearGuestDocIds: () => void;

    // UI
    isLoginModalOpen: boolean;
    setLoginModalOpen: (isOpen: boolean) => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            // Current document
            currentDocument: null,
            setCurrentDocument: (doc) => set({
                currentDocument: doc,
                currentPage: 1,
                chatSessionId: null,
                activeCitation: null,
            }),

            // PDF viewer
            currentPage: 1,
            setCurrentPage: (page) => set({ currentPage: page }),
            zoom: 1,
            setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(3, zoom)) }),

            // Citation
            activeCitation: null,
            setActiveCitation: (citation) => set((state) => {
                // Also navigate to the citation's page
                if (citation) {
                    return { activeCitation: citation, currentPage: citation.page };
                }
                return { activeCitation: null };
            }),

            // Chat
            chatSessionId: null,
            setChatSessionId: (id) => set({ chatSessionId: id }),
            isChatOpen: true,
            toggleChat: () => set((state) => ({ isChatOpen: !state.isChatOpen })),

            // Documents
            documents: [],
            setDocuments: (docs) => set({ documents: docs }),
            addDocument: (doc) => set((state) => ({
                documents: [doc, ...state.documents]
            })),
            updateDocument: (id, updates) => set((state) => ({
                documents: state.documents.map((d) =>
                    d.id === id ? { ...d, ...updates } : d
                ),
            })),
            removeDocument: (id) => set((state) => ({
                documents: state.documents.filter((d) => d.id !== id),
            })),

            // Guest mode
            guestDocIds: [],
            addGuestDocId: (id) => set((state) => ({ guestDocIds: [...state.guestDocIds, id] })),
            clearGuestDocIds: () => set({ guestDocIds: [] }),

            // UI
            isLoginModalOpen: false,
            setLoginModalOpen: (isOpen) => set({ isLoginModalOpen: isOpen }),
        }), {
        name: 'autophile-storage',
        partialize: (state) => ({
            guestDocIds: state.guestDocIds,
            // Optionally persist other prefs if needed
        }),
    }));

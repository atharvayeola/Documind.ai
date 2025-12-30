'use client';

/**
 * Main Layout Component - Documind.ai
 * Professional Split-Screen Layout (PDF Left, Chat Right)
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    PanelLeft,
    Share,
    User,
    MessageCircle,
    GripVertical,
    LogOut
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import DocumentLibrary from './DocumentLibrary';
import PDFViewer from '@/components/pdf-viewer/PDFViewer';
import ChatPanel from '@/components/chat/ChatPanel';
import { useAppStore } from '@/store';
import { documentApi, Document } from '@/lib/api';
import LoginModal from '@/components/auth/LoginModal';

export default function MainLayout() {
    const {
        currentDocument,
        setCurrentDocument,
        setDocuments,
        guestDocIds
    } = useAppStore();

    const [showSidebar, setShowSidebar] = useState(false);
    const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);

    // Auto-open sidebar when document opens or documents are added
    const { documents } = useAppStore();
    useEffect(() => {
        if (currentDocument || documents.length > 0) setShowSidebar(true);
    }, [currentDocument, documents.length]);

    // Auto-claim anonymous docs if logged in
    const { user } = useAuthStore();
    const { clearGuestDocIds } = useAppStore();
    useEffect(() => {
        if (user && guestDocIds.length > 0) {
            documentApi.claim(guestDocIds)
                .then(() => {
                    clearGuestDocIds();
                    // Reload list
                    documentApi.list(0, 20).then(res => setDocuments(res.documents));
                })
                .catch(console.error);
        }
    }, [user, guestDocIds, clearGuestDocIds, setDocuments]);

    // Split Plane Logic
    const [chatWidth, setChatWidth] = useState(50); // percentage
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Load documents on mount and when user changes (login/logout)
    const prevUserRef = useRef<typeof user>(undefined);
    useEffect(() => {
        const loadDocuments = async () => {
            try {
                // For logged-in users, don't pass guestDocIds - backend uses owner_id
                // For anonymous users, pass guestDocIds to show their uploaded docs
                const currentGuestIds = useAppStore.getState().guestDocIds;
                const idsToPass = user ? undefined : currentGuestIds;
                console.log('Loading documents...', { user: !!user, guestDocIds: currentGuestIds, idsToPass });
                const response = await documentApi.list(0, 20, undefined, idsToPass);
                console.log('Loaded documents:', response.documents.length);
                setDocuments(response.documents);
            } catch (err) {
                console.error('Failed to load documents:', err);
            } finally {
                setIsLoadingDocuments(false);
            }
        };

        // Always reload when user changes (login/logout) or on initial mount
        if (prevUserRef.current !== user) {
            prevUserRef.current = user;
            loadDocuments();
        }
    }, [setDocuments, user]);

    const handleDocumentSelect = (doc: Document) => {
        setCurrentDocument(doc);
    };

    // Resizing Logic
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || !containerRef.current) return;

            const containerRect = containerRef.current.getBoundingClientRect();
            const newChatWidth = ((containerRect.right - e.clientX) / containerRect.width) * 100;

            // Constrain between 20% and 80%
            if (newChatWidth >= 20 && newChatWidth <= 80) {
                setChatWidth(newChatWidth);
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    return (
        <div className="h-screen flex flex-col bg-white text-slate-900 font-sans">
            {/* Header - Documind Style */}
            <header className="h-14 border-b border-slate-200 px-4 flex items-center justify-between bg-white flex-shrink-0 z-20 shadow-sm">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setShowSidebar(!showSidebar)}
                        className="p-2 rounded-md hover:bg-slate-100 text-slate-500 transition-colors"
                        title={showSidebar ? "Close Sidebar" : "Open Sidebar"}
                    >
                        <PanelLeft size={20} />
                    </button>

                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
                            <span className="text-white font-bold text-lg tracking-tight">D</span>
                        </div>
                        <span className="font-bold text-lg text-slate-900 tracking-tight">Documind<span className="text-blue-600">.ai</span></span>
                    </div>

                    {currentDocument && (
                        <div className="hidden md:flex h-6 w-[1px] bg-slate-200 mx-2" />
                    )}

                    {currentDocument && (
                        <div className="hidden md:flex items-center gap-2 text-sm text-slate-600 font-medium">
                            <span>{currentDocument.original_filename}</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Share removed - moved to ChatPanel */}
                    <UserMenu />
                </div>
            </header>

            {/* Main Workspace */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* 1. Document Library Sidebar (Left) */}
                <AnimatePresence mode="wait">
                    {showSidebar && (
                        <motion.aside
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 280, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                            className="border-r border-slate-200 bg-slate-50 overflow-hidden flex-shrink-0 z-10"
                        >
                            <DocumentLibrary
                                onDocumentSelect={handleDocumentSelect}
                            />
                        </motion.aside>
                    )}
                </AnimatePresence>

                {/* 2. Split Pane Area */}
                <div ref={containerRef} className="flex-1 flex overflow-hidden relative bg-slate-100">
                    {currentDocument ? (
                        <>
                            {/* Left Pane: PDF Viewer */}
                            <div
                                style={{ width: `${100 - chatWidth}%` }}
                                className="h-full overflow-hidden flex flex-col relative transition-all duration-300 ease-in-out"
                            >
                                <PDFViewer
                                    url={documentApi.getPdfUrl(currentDocument.id)}
                                    documentId={currentDocument.id}
                                    onEditModeChange={(isEditing) => {
                                        if (isEditing) {
                                            setChatWidth(30); // Shrink chat to 30%
                                        } else {
                                            setChatWidth(50); // Restore to 50%
                                        }
                                    }}
                                />
                            </div>

                            {/* Resizer Handle */}
                            <div
                                onMouseDown={handleMouseDown}
                                className={`w-1.5 hover:w-2 bg-slate-200 hover:bg-blue-400 cursor-col-resize z-20 flex items-center justify-center transition-all flex-shrink-0 border-l border-r border-slate-300 ${isDragging ? 'bg-blue-500 w-2' : ''}`}
                            >
                                <div className="h-8 w-1 rounded-full bg-slate-400 opacity-50" />
                            </div>

                            {/* Right Pane: Chat Panel */}
                            <div
                                style={{ width: `${chatWidth}%` }}
                                className="h-full overflow-hidden bg-white flex flex-col relative shadow-xl z-10"
                                onClickCapture={() => {
                                    // If expanded (chat < 50%), restore to 50% on interaction
                                    if (chatWidth < 50) setChatWidth(50);
                                }}
                            >
                                <ChatPanel
                                    documentId={currentDocument.id}
                                    filename={currentDocument.original_filename}
                                />
                            </div>
                        </>
                    ) : (
                        // Empty State - Hero Upload
                        <div className="flex-1 overflow-auto bg-slate-50/50">
                            <DocumentLibrary
                                onDocumentSelect={handleDocumentSelect}
                                variant="hero"
                            />
                        </div>
                    )}
                </div>
            </div>
            <LoginModal />
        </div>
    );
}

function UserMenu() {
    const { user, logout } = useAuthStore();
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();

    const handleLogout = () => {
        logout();
        window.location.href = '/login'; // Force reload/redirect
    };

    if (!user) {
        return (
            <button
                onClick={() => router.push('/login')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
                Sign In
            </button>
        );
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 hover:bg-blue-200 transition-colors border-2 border-white ring-2 ring-transparent hover:ring-blue-100"
                title="Account Settings"
            >
                {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-full h-full rounded-full object-cover" />
                ) : (
                    <span className="font-bold text-xs">{user.name?.[0]?.toUpperCase() || 'U'}</span>
                )}
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-4 py-3 border-b border-slate-50 bg-slate-50/50">
                            <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
                            <p className="text-xs text-slate-500 truncate">{user.email}</p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                        >
                            <LogOut size={14} />
                            Sign Out
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

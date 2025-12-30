'use client';

/**
 * Chat Panel Component - Documind.ai
 * Split-pane optimized
 */
import { useState, useRef, useEffect, KeyboardEvent, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    Send,
    Loader2,
    Copy,
    Check,
    MessageCircle,
    X,
    Download,
    Search,
    BookOpen,
    Plus,
    XCircle,
    History,
    RotateCcw,
    Sparkles,
    Square,
    ChevronDown,
    RefreshCw,
    Paperclip,
    Trash2,
    FileText,
} from 'lucide-react';
import { useAppStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { chatApi, Citation, ChatMessage } from '@/lib/api';

interface ThinkingContext {
    page: number;
    section: string | null;
    preview: string;
}

interface ThinkingState {
    stage: 'searching' | 'reading' | 'generating' | 'complete';
    content: string;
    context?: ThinkingContext[];
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    citations?: Citation[];
    isStreaming?: boolean;
    thinking?: ThinkingState;
    created_at?: string;
}

const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    let d = dateStr;
    if (!d.endsWith('Z') && !d.includes('+')) d += 'Z';
    return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getDateLabel = (dateStr?: string) => {
    if (!dateStr) return '';
    let d = dateStr;
    if (!d.endsWith('Z') && !d.includes('+')) d += 'Z';
    const date = new Date(d);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString();
};

interface ChatSession {
    id: number;
    title: string;
    created_at: string;
}

// Thinking Indicator Component - Shows AI thinking process with collapsible context
function ThinkingIndicator({ thinking, isComplete }: { thinking: ThinkingState; isComplete: boolean }) {
    const [isExpanded, setIsExpanded] = useState(false);

    const stageIcons: Record<string, React.ReactNode> = {
        searching: <Search size={12} className="text-blue-500" />,
        reading: <FileText size={12} className="text-amber-500" />,
        generating: <Sparkles size={12} className="text-purple-500" />,
        complete: <Check size={12} className="text-green-500" />,
    };

    const stageColors: Record<string, string> = {
        searching: 'bg-blue-50 border-blue-200 text-blue-700',
        reading: 'bg-amber-50 border-amber-200 text-amber-700',
        generating: 'bg-purple-50 border-purple-200 text-purple-700',
        complete: 'bg-green-50 border-green-200 text-green-700',
    };

    return (
        <div className={`mb-3 rounded-lg border text-xs ${stageColors[thinking.stage] || stageColors.searching}`}>
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-opacity-70 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {!isComplete && thinking.stage !== 'complete' ? (
                        <div className="animate-spin">
                            <Loader2 size={12} />
                        </div>
                    ) : stageIcons[thinking.stage]}
                    <span className="font-medium">{thinking.content}</span>
                </div>
                <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isExpanded && thinking.context && thinking.context.length > 0 && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="px-3 pb-2 space-y-2 border-t border-current/10 pt-2">
                            <span className="text-[10px] uppercase tracking-wider opacity-70">Context Retrieved:</span>
                            {thinking.context.map((ctx, i) => (
                                <div key={i} className="bg-white/50 rounded px-2 py-1.5 text-slate-600">
                                    <div className="flex items-center gap-1 mb-0.5">
                                        <FileText size={10} />
                                        <span className="font-medium">Page {ctx.page}</span>
                                        {ctx.section && <span className="text-slate-400">• {ctx.section}</span>}
                                    </div>
                                    <p className="text-[11px] opacity-80 line-clamp-2">{ctx.preview}</p>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

interface ChatPanelProps {
    documentId: number;
    filename?: string;
    onCitationClick?: (citation: Citation) => void;
}

export default function ChatPanel({ documentId, filename, onCitationClick }: ChatPanelProps) {
    const {
        chatSessionId,
        setChatSessionId,
        setActiveCitation,
        // isChatOpen is handled by parent layout now
    } = useAppStore();

    const [messages, setMessages] = useState<Message[]>([]);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
    const [isNewChat, setIsNewChat] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const historyRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
                setShowHistoryDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Generate dynamic suggestions based on filename
    const getSuggestions = () => {
        // Generalized suggestions that work for any document
        return [
            { icon: <BookOpen size={14} />, text: 'Summarize this document' },
            { icon: <Search size={14} />, text: 'What are the key points?' },
            { icon: <Download size={14} />, text: 'List the main topics covered' },
        ];
    };

    const suggestions = useMemo(() => getSuggestions(), [filename]);

    // Reset chat session when document changes
    useEffect(() => {
        setChatSessionId(null);
        setMessages([]);
        setIsNewChat(true);
    }, [documentId, setChatSessionId]);

    // Load sessions & history when document changes
    useEffect(() => {
        if (!documentId) return;

        const loadSessions = async () => {
            setIsHistoryLoading(true);
            try {
                // Get all sessions for this document
                const allSessions = await chatApi.listSessions(documentId);
                setSessions(allSessions);

                // Load messages for the current session if one exists
                if (chatSessionId) {
                    const history = await chatApi.getHistory(chatSessionId);
                    setMessages(history.messages.map((m: ChatMessage) => ({
                        id: m.id.toString(),
                        role: m.role,
                        content: m.content,
                        citations: m.citations || undefined,
                        created_at: m.created_at
                    })));
                } else {
                    setMessages([]);
                }
            } catch (err) {
                console.error('Failed to load chat history:', err);
            } finally {
                setIsHistoryLoading(false);
            }
        };

        loadSessions();
    }, [documentId, chatSessionId]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isHistoryLoading]);

    // Auto-resize textarea
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        }
    }, [input]);

    // Highlight matching text in search
    const highlightText = (text: string, query: string): React.ReactNode => {
        if (!query.trim()) return text;

        const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
        return parts.map((part, i) =>
            part.toLowerCase() === query.toLowerCase()
                ? <mark key={i} className="bg-yellow-300 text-slate-900 px-0.5 rounded font-medium">{part}</mark>
                : part
        );
    };

    // Filter messages based on search
    const filteredMessages = useMemo(() => {
        if (!searchQuery.trim()) return messages;
        return messages.filter((m) =>
            m.content.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [messages, searchQuery]);

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsLoading(false);
            setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
        }
    };

    const handleSend = async (overrideText?: string) => {
        // Handle both event object or string
        const isEvent = overrideText && typeof overrideText === 'object';
        const text = (!isEvent && typeof overrideText === 'string') ? overrideText : input.trim();

        if (!text || isLoading) return;

        // Check Auth
        const { user } = useAuthStore.getState();
        if (!user) {
            useAppStore.getState().setLoginModalOpen(true);
            return;
        }

        // Only clear input if this is a new message from input
        if (!overrideText || isEvent) {
            setInput('');
        }

        // Add optimistic user message only if new
        const tempId = `user-${Date.now()}`;
        setMessages((prev) => [...prev, {
            id: tempId,
            role: 'user',
            content: text,
            created_at: new Date().toISOString()
        }]);

        setIsLoading(true);
        setError(null);

        // Setup AbortController
        abortControllerRef.current = new AbortController();

        // Placeholder for assistant response
        const assistantId = `assistant-${Date.now()}`;
        setMessages((prev) => [
            ...prev,
            {
                id: assistantId,
                role: 'assistant',
                content: '',
                isStreaming: true, // Mark active streaming for cursor/UI
                created_at: new Date().toISOString()
            },
        ]);

        try {
            let fullContent = '';
            let citations: Citation[] = [];
            let thinkingState: ThinkingState | undefined;

            // Pass abort signal
            for await (const chunk of chatApi.stream(documentId, text, chatSessionId, abortControllerRef.current.signal)) {
                if (chunk.type === 'error') {
                    throw new Error(chunk.content);
                }
                if (chunk.type === 'thinking') {
                    // Update thinking state, preserving context from previous stages
                    thinkingState = {
                        stage: chunk.stage,
                        content: chunk.content,
                        context: chunk.context || thinkingState?.context // Preserve context if not provided in this event
                    };
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId
                                ? { ...m, thinking: thinkingState }
                                : m
                        )
                    );
                } else if (chunk.type === 'content' && chunk.content) {
                    fullContent += chunk.content;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId
                                ? { ...m, content: fullContent, thinking: thinkingState ? { ...thinkingState, stage: 'complete' } : undefined }
                                : m
                        )
                    );
                } else if (chunk.type === 'citations' && chunk.citations) {
                    citations = chunk.citations;
                }
            }

            // Final update with citations and clear streaming status
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === assistantId
                        ? { ...m, citations, isStreaming: false }
                        : m
                )
            );

            // Refresh sessions if this was a new chat to capture the new session ID
            if (!chatSessionId || isNewChat) {
                const allSessions = await chatApi.listSessions(documentId);
                // Find session that matches our title roughly or just most recent
                if (allSessions.length > 0) {
                    setSessions(allSessions);
                    setChatSessionId(allSessions[0].id);
                    setIsNewChat(false);
                }
            }

        } catch (err: any) {
            if (err.name === 'AbortError') {
                console.log('Generation stopped by user');
                // Keep partial content but mark stopped
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === assistantId
                            ? { ...m, isStreaming: false }
                            : m
                    )
                );
            } else {
                console.error('Chat failed:', err);
                setError('Failed to generate response. Please try again.');
                setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            }
        } finally {
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleCitationClick = (citation: Citation) => {
        setActiveCitation(citation);
        onCitationClick?.(citation);
    };

    const copyToClipboard = async (text: string, id: string) => {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const startNewChat = () => {
        setIsNewChat(true);
        setChatSessionId(null); // Clear session
        setMessages([]); // Clear messages
        setSearchQuery('');
        setShowSearch(false);
        setShowHistoryDropdown(false);
        setError(null);
        setTimeout(() => inputRef.current?.focus(), 100);
    };

    const switchSession = async (sessionId: number) => {
        setChatSessionId(sessionId);
        setShowHistoryDropdown(false);
        setIsNewChat(false); // Reset new chat flag
    };

    const handleClearChat = async () => {
        if (chatSessionId) {
            try {
                await chatApi.deleteSession(chatSessionId);
                // Update local session list
                setSessions(prev => prev.filter(s => s.id !== chatSessionId));
            } catch (err) {
                console.error("Failed to delete", err);
            }
        }
        // Always reset UI
        startNewChat();
    };

    const exportChat = () => {
        const markdown = messages
            .map((m) => {
                const role = m.role === 'user' ? '**You:**' : '**Assistant:**';
                let content = `${role}\n${m.content}`;
                if (m.citations?.length) {
                    content += '\n\n*Sources:*\n';
                    content += m.citations.map((c) => `- Page ${c.page}: ${c.text.slice(0, 100)}...`).join('\n');
                }
                return content;
            })
            .join('\n\n---\n\n');

        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const MessageContent = ({ content, citations }: { content: string, citations?: Citation[] }) => {
        const processText = (text: any): React.ReactNode => {
            if (typeof text !== 'string') return text;
            const citationRegex = /(\[(?:Source\s+\d+,?\s*)?(?:Pages?|p\.?)\s*\d+(?:-\d+)?(?:,\s*[^\]]+)?\])/gi;
            const parts = text.split(citationRegex);
            return parts.map((part, i) => {
                const pageMatch = part.match(/(?:Pages?|p\.?)\s*(\d+)/i);
                if (pageMatch && part.trim().startsWith('[')) {
                    const pageNum = parseInt(pageMatch[1]);
                    const citation = citations?.find(c => c.page === pageNum);
                    return (
                        <button
                            key={i}
                            onClick={() => {
                                if (citation) setActiveCitation(citation);
                                else setActiveCitation({ page: pageNum, text: '', chunk_id: 0, section: '' });
                            }}
                            className="inline-flex items-center justify-center mx-0.5 align-middle p-1 rounded-full bg-blue-100/50 text-blue-600 hover:bg-blue-200 hover:scale-110 transition-all border border-blue-200 shadow-sm"
                            title={`View Page ${pageNum}`}
                        >
                            <Paperclip size={12} className="stroke-2" />
                        </button>
                    );
                }
                return searchQuery ? highlightText(part, searchQuery) : part;
            });
        };

        const processChildren = (children: any) =>
            Array.isArray(children)
                ? children.map((child: any, i: number) => <span key={i}>{processText(child)}</span>)
                : processText(children);

        const components: any = {
            p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-relaxed text-slate-700">{processChildren(children)}</p>,
            li: ({ children }: any) => <li className="text-slate-700 leading-relaxed pl-1">{processChildren(children)}</li>,
            blockquote: ({ children }: any) => <blockquote className="border-l-2 border-blue-500 pl-3 italic text-slate-600 my-2">{processChildren(children)}</blockquote>,
            strong: ({ children }: any) => <strong className="font-semibold text-slate-900">{processChildren(children)}</strong>,
            a: ({ href, children }: any) => <a href={href} className="text-blue-600 hover:underline font-medium" target="_blank" rel="noopener noreferrer">{children}</a>,
            ul: ({ children }: any) => <ul className="list-disc list-outside mb-4 pl-4 space-y-1">{children}</ul>,
            ol: ({ children }: any) => <ol className="list-decimal list-outside mb-4 pl-4 space-y-1">{children}</ol>,
            h1: ({ children }: any) => <h1 className="text-lg font-bold text-slate-900 mt-4 mb-2">{children}</h1>,
            h2: ({ children }: any) => <h2 className="text-base font-bold text-slate-900 mt-4 mb-2">{children}</h2>,
            h3: ({ children }: any) => <h3 className="text-sm font-bold text-slate-900 mt-3 mb-1.5">{children}</h3>,
            code: ({ children }: any) => <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-slate-800">{children}</code>,
        };
        return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>;
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-100 sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-600/10 flex items-center justify-center text-blue-600 relative">
                        <MessageCircle size={18} />
                        <Sparkles size={10} className="absolute -bottom-0.5 -right-1 text-yellow-500 fill-yellow-500" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-slate-900">Research Assistant</h2>
                        <div className="flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                            <span className="text-[11px] font-medium text-slate-500">Online</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {/* History Dropdown */}
                    <div className="relative" ref={historyRef}>
                        <button
                            onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
                            className={`p-2 rounded-md transition-colors ${showHistoryDropdown ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-50 text-slate-500'}`}
                            title="Chat history"
                        >
                            <History size={18} />
                        </button>
                        <AnimatePresence>
                            {showHistoryDropdown && (
                                <motion.div
                                    initial={{ opacity: 0, y: -8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden z-50"
                                >
                                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Chat History</span>
                                    </div>
                                    <div className="max-h-64 overflow-y-auto">
                                        {sessions.length === 0 ? (
                                            <div className="px-3 py-4 text-center text-sm text-slate-400">
                                                No previous chats
                                            </div>
                                        ) : (
                                            sessions.map((session) => (
                                                <button
                                                    key={session.id}
                                                    onClick={() => switchSession(session.id)}
                                                    className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors ${chatSessionId === session.id ? 'bg-blue-50' : ''}`}
                                                >
                                                    <div className="text-sm font-medium text-slate-800 truncate">{session.title}</div>
                                                    <div className="text-[10px] text-slate-400">{new Date((session.created_at.endsWith('Z') || session.created_at.includes('+')) ? session.created_at : session.created_at + 'Z').toLocaleDateString()}</div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <button
                        onClick={() => setShowSearch(!showSearch)}
                        className={`p-2 rounded-md transition-colors ${showSearch ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-50 text-slate-500'}`}
                        title="Search messages"
                    >
                        <Search size={18} />
                    </button>
                    <button
                        onClick={handleClearChat}
                        className="p-2 rounded-md hover:bg-slate-50 text-slate-500 hover:text-red-500 transition-colors"
                        title="Clear chat"
                    >
                        <Trash2 size={18} />
                    </button>
                    <button
                        onClick={startNewChat}
                        className="p-2 rounded-md hover:bg-slate-50 text-slate-500 transition-colors"
                        title="New chat"
                    >
                        <Plus size={18} />
                    </button>
                </div>
            </div>

            {/* Search Bar */}
            <AnimatePresence>
                {showSearch && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-4 py-3 border-b border-slate-100 bg-white"
                    >
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search messages..."
                                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                                autoFocus
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth custom-scrollbar bg-slate-50/50">
                {isHistoryLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                        <Loader2 size={32} className="animate-spin text-blue-500" />
                        <span className="text-sm font-medium">Loading conversation...</span>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full max-w-xs mx-auto text-center">
                        <div className="w-16 h-16 rounded-2xl bg-white shadow-sm border border-slate-200 flex items-center justify-center mb-6 relative">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                                <MessageCircle size={20} />
                            </div>
                            <Sparkles size={14} className="absolute -bottom-1 -right-1 text-yellow-400 fill-yellow-400" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-2">How can I help you?</h3>
                        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                            I've analyzed the document. Ask me to summarize key metrics, identify risks, or find specific details.
                        </p>

                        <div className="grid grid-cols-1 w-full gap-2.5">
                            {suggestions.map((item, i) => (
                                <button
                                    key={i}
                                    onClick={() => setInput(item.text)}
                                    className="flex items-center gap-3 px-4 py-3 text-sm bg-white border border-slate-200 hover:border-blue-300 hover:shadow-md rounded-xl transition-all text-slate-700 font-medium group text-left"
                                >
                                    <span className="p-1.5 rounded-md bg-slate-50 text-slate-500 group-hover:text-blue-600 transition-colors">
                                        {item.icon}
                                    </span>
                                    {item.text}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <AnimatePresence mode="popLayout">
                            {filteredMessages.map((message, index) => {
                                const showDateSeparator = index === 0 ||
                                    (message.created_at && filteredMessages[index - 1]?.created_at &&
                                        getDateLabel(message.created_at) !== getDateLabel(filteredMessages[index - 1].created_at));

                                return (
                                    <div key={message.id}>
                                        {showDateSeparator && (
                                            <div className="flex items-center justify-center my-6">
                                                <div className="h-px bg-slate-100 w-16" />
                                                <span className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                    {getDateLabel(message.created_at || new Date().toISOString())}
                                                </span>
                                                <div className="h-px bg-slate-100 w-16" />
                                            </div>
                                        )}
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className={`flex gap-4 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                                        >
                                            {/* Avatar */}
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm mt-1
                                        ${message.role === 'user' ? 'bg-white text-blue-600 border border-blue-200' : 'bg-white text-blue-600 border border-slate-100'}`}>
                                                {message.role === 'user' ? (
                                                    <span className="text-[10px] font-bold">YOU</span>
                                                ) : (
                                                    <div className="relative">
                                                        <MessageCircle size={14} />
                                                        <Sparkles size={6} className="absolute -bottom-0.5 -right-1 text-yellow-400 fill-yellow-400" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Bubble */}
                                            <div className={`flex flex-col max-w-[85%] ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                                                {message.role === 'assistant' && (
                                                    <span className="text-[10px] text-slate-400 mb-1 ml-1 font-medium">AI Assistant</span>
                                                )}

                                                <div
                                                    className={`
                                                relative px-5 py-3.5 text-sm leading-6 shadow-sm
                                                ${message.role === 'user'
                                                            ? 'bg-slate-900 text-white rounded-2xl rounded-tr-sm'
                                                            : 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-sm'
                                                        }
                                            `}
                                                >
                                                    {message.role === 'user' ? (
                                                        <p>{searchQuery ? highlightText(message.content, searchQuery) : message.content}</p>
                                                    ) : (
                                                        <div className="prose prose-sm max-w-none prose-p:text-slate-700 prose-headings:text-slate-900 prose-strong:text-slate-900 prose-ul:my-2 prose-li:my-0">
                                                            {/* Thinking Indicator */}
                                                            {message.thinking && (
                                                                <ThinkingIndicator thinking={message.thinking} isComplete={!!message.content} />
                                                            )}
                                                            {/* Show loading dots if thinking but no content yet */}
                                                            {message.isStreaming && !message.content && !message.thinking && (
                                                                <div className="flex items-center gap-1">
                                                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                                                </div>
                                                            )}
                                                            <MessageContent content={message.content} citations={message.citations} />
                                                        </div>
                                                    )}

                                                    {/* Timestamp */}
                                                    {message.created_at && (
                                                        <div className={`text-[9px] mt-1.5 font-medium opacity-60 flex items-center gap-1 ${message.role === 'user' ? 'text-blue-100 justify-end' : 'text-slate-400'}`}>
                                                            {formatTime(message.created_at)}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Actions for User - Retry */}
                                                {message.role === 'user' && (
                                                    <div className="flex items-center gap-2 mt-2 mr-1">
                                                        <button
                                                            onClick={() => handleSend(message.content)}
                                                            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-600 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-100"
                                                            disabled={isLoading}
                                                        >
                                                            <RefreshCw size={12} />
                                                            Retry
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Simplified Actions for Assistant */}
                                                {message.role === 'assistant' && !message.isStreaming && (
                                                    <div className="flex items-center gap-2 mt-2 ml-1">
                                                        <button
                                                            onClick={() => copyToClipboard(message.content, message.id)}
                                                            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-100"
                                                        >
                                                            {copiedId === message.id ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                                            Copy
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    </div>
                                );
                            })}
                        </AnimatePresence>
                        {
                            error && (
                                <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 flex items-center gap-2">
                                    <XCircle size={16} />
                                    {error}
                                </div>
                            )
                        }
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-slate-100">
                <div className="relative flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-xl p-1.5 focus-within:ring-2 focus-within:ring-blue-500/10 focus-within:border-blue-500/50 transition-all hover:border-slate-300">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask anything about the document..."
                        rows={1}
                        className="flex-1 max-h-32 min-h-[44px] pl-3 pr-2 py-2.5 bg-transparent border-none focus:ring-0 text-sm resize-none text-slate-900 placeholder:text-slate-400"
                        style={{ height: '44px' }}
                    />
                    {isLoading ? (
                        <button
                            onClick={handleStop}
                            className="p-2.5 mb-0.5 mr-0.5 bg-white text-blue-600 rounded-full hover:bg-slate-50 transition-all shadow-sm active:scale-95 flex-shrink-0 border border-blue-200"
                            title="Stop generating"
                        >
                            <Square size={16} className="fill-current" />
                        </button>
                    ) : (
                        <button
                            onClick={() => handleSend()}
                            disabled={!input.trim()}
                            className="p-2.5 mb-0.5 mr-0.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-30 disabled:hover:bg-blue-600 transition-all shadow-sm active:scale-95 flex-shrink-0"
                        >
                            <Send size={16} className={input.trim() ? 'translate-x-0.5 relative' : ''} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

'use client';

/**
 * PDF Viewer Component
 * Professional editor with robust highlighting, draggable notes, rich text editing, and proper navigation.
 * UPDATES: Fixed Sidebar Thumbnails, Hardened Undo/Redo, explicit Text Edit mode.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ZoomIn,
    ZoomOut,
    ChevronLeft,
    ChevronRight,
    Maximize2,
    Minimize2,
    Loader2,
    Highlighter,
    Download,
    Trash2,
    Undo2,
    Redo2,
    StickyNote,
    Type,
    Move,
    Bold,
    Italic,
    Printer,
    X,
    MousePointer2,
    Pencil,
    ChevronDown,
    CheckCircle2,
    XCircle,
    MessageSquarePlus,
    Sparkles,
    Check,
} from 'lucide-react';
import { useAppStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { api, annotationApi, Annotation, AnnotationCreate } from '@/lib/api';
import { getErrorMessage } from '@/lib/api';

import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

// --- Dynamic Imports ---
const Document = dynamic(() => import('react-pdf').then((mod) => mod.Document), { ssr: false });
const Page = dynamic(() => import('react-pdf').then((mod) => mod.Page), { ssr: false });

if (typeof window !== 'undefined') {
    import('react-pdf').then((pdfjs) => {
        pdfjs.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.pdfjs.version}/build/pdf.worker.min.mjs`;
    });
}

// --- Constants ---
const HIGHLIGHT_COLORS = [
    { name: 'Yellow', value: '#fbbf24', bg: 'rgba(251, 191, 36, 0.4)' },
    { name: 'Green', value: '#4ade80', bg: 'rgba(74, 222, 128, 0.4)' },
    { name: 'Blue', value: '#60a5fa', bg: 'rgba(96, 165, 250, 0.4)' },
    { name: 'Orange', value: '#fb923c', bg: 'rgba(251, 146, 60, 0.4)' },
];

const NOTE_COLORS = [
    { name: 'Yellow', bg: '#fef9c3', border: '#ca8a04', text: '#000000' },
    { name: 'Blue', bg: '#eff6ff', border: '#2563eb', text: '#000000' },
    { name: 'Green', bg: '#f0fdf4', border: '#16a34a', text: '#000000' },
    { name: 'White', bg: '#ffffff', border: '#475569', text: '#000000' },
];

// --- Types ---
interface Rect { x: number; y: number; width: number; height: number; }

interface Highlight {
    id: string;
    page: number;
    rects: Rect[];
    text: string;
    color: string;
}

interface Note {
    id: string;
    page: number;
    x: number;
    y: number;
    text: string;
    color: typeof NOTE_COLORS[0];
    isOpen: boolean;
}

interface TextEdit {
    id: string;
    page: number;
    x: number;
    y: number;
    width?: number;
    height?: number;
    html: string;
    redactionRects?: Rect[];
}

// Suggestion for "Suggest Edit" mode (Google Docs style)
interface Suggestion {
    id: string;
    page: number;
    originalText: string;
    suggestedText: string;
    rects: Rect[]; // Position of original text for strikethrough
    status: 'pending' | 'accepted' | 'rejected';
    createdAt: number;
}

type EditModeType = 'none' | 'edit' | 'suggest';

// Explicit definition of History Payload for clearer debugging
type HistoryAction =
    | { type: 'HIGHLIGHT_ADD'; payload: Highlight }
    | { type: 'HIGHLIGHT_REMOVE'; payload: Highlight }
    | { type: 'NOTE_ADD'; payload: Note }
    | { type: 'NOTE_REMOVE'; payload: Note }
    | { type: 'NOTE_MOVE'; payload: { id: string; from: { x: number; y: number }; to: { x: number; y: number } } }
    | { type: 'NOTE_EDIT'; payload: { id: string; from: string; to: string } }
    | { type: 'TEXT_ADD'; payload: TextEdit }
    | { type: 'TEXT_REMOVE'; payload: TextEdit }
    | { type: 'TEXT_MOVE'; payload: { id: string; from: { x: number; y: number }; to: { x: number; y: number } } }
    | { type: 'TEXT_EDIT'; payload: { id: string; from: string; to: string } }
    | { type: 'SUGGESTION_ADD'; payload: Suggestion }
    | { type: 'SUGGESTION_REMOVE'; payload: Suggestion }
    | { type: 'SUGGESTION_ACCEPT'; payload: Suggestion }
    | { type: 'SUGGESTION_REJECT'; payload: Suggestion };

interface PDFViewerProps {
    url: string;
    documentId?: number;
    onTextSelect?: (text: string, page: number) => void;
    onEditModeChange?: (isEditing: boolean) => void;
}

// --- Utils ---
const generateId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export default function PDFViewer({ url, documentId, onTextSelect, onEditModeChange }: PDFViewerProps) {
    const { currentPage, setCurrentPage, zoom, setZoom, activeCitation } = useAppStore();
    const { user } = useAuthStore();

    // Backend ID Mapping (Local UUID -> Backend Int ID)
    const backendIdMap = useRef<Map<string, number>>(new Map());

    const [numPages, setNumPages] = useState(0);
    const [showThumbnails, setShowThumbnails] = useState(true);
    const [pageWidth, setPageWidth] = useState(800);
    const [isClient, setIsClient] = useState(false);

    // Annotations
    const [highlights, setHighlights] = useState<Highlight[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [textEdits, setTextEdits] = useState<TextEdit[]>([]);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

    // Modes
    const [highlightMode, setHighlightMode] = useState(false);
    const [noteMode, setNoteMode] = useState(false);
    const [textEditMode, setTextEditMode] = useState(false); // Add new text box
    const [editPdfTextMode, setEditPdfTextMode] = useState(false); // Edit existing PDF text
    const [editModeType, setEditModeType] = useState<EditModeType>('none'); // Edit vs Suggest
    const [showEditDropdown, setShowEditDropdown] = useState(false);
    const [showSuggestionsSidebar, setShowSuggestionsSidebar] = useState(false);

    // Formatting Selection
    const [selectedHighlightColor, setSelectedHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
    const [selectedNoteColor, setSelectedNoteColor] = useState(NOTE_COLORS[0]);
    const [activeTextId, setActiveTextId] = useState<string | null>(null);
    const [isSaved, setIsSaved] = useState(false); // State for save button animation

    // Undo/Redo Stacks
    const [undoStack, setUndoStack] = useState<HistoryAction[]>([]);
    const [redoStack, setRedoStack] = useState<HistoryAction[]>([]);

    // Dragging
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
    const [itemStartPos, setItemStartPos] = useState({ x: 0, y: 0 });

    const containerRef = useRef<HTMLDivElement>(null);
    const pageRef = useRef<HTMLDivElement>(null);

    useEffect(() => { setIsClient(true); }, []);

    // --- Sync Logic ---
    const loadAnnotations = async () => {
        console.log('[AnnotationSync] loadAnnotations called. documentId:', documentId, 'user:', user?.email);
        if (!documentId || !user) {
            console.log('[AnnotationSync] Skipping load - missing documentId or user');
            return;
        }
        try {
            console.log('[AnnotationSync] Fetching annotations for document:', documentId);
            const serverAnns = await annotationApi.list(documentId);
            console.log('[AnnotationSync] Received annotations from server:', serverAnns);
            const newHighlights: Highlight[] = [];
            const newNotes: Note[] = [];
            const newTexts: TextEdit[] = [];
            const newMap = new Map<string, number>();

            serverAnns.forEach(ann => {
                const localId = generateId();
                newMap.set(localId, ann.id);

                if (ann.annotation_type === 'highlight') {
                    newHighlights.push({
                        id: localId,
                        page: ann.page_number,
                        text: ann.selected_text || '',
                        color: ann.color,
                        rects: ann.bbox.rects || []
                    });
                } else if (ann.annotation_type === 'note') {
                    newNotes.push({
                        id: localId,
                        page: ann.page_number,
                        x: ann.bbox.x,
                        y: ann.bbox.y,
                        text: ann.note || '',
                        color: typeof ann.color === 'string' && ann.color.startsWith('{') ? JSON.parse(ann.color) : NOTE_COLORS[0],
                        isOpen: false
                    });
                } else if (ann.annotation_type === 'text') {
                    newTexts.push({
                        id: localId,
                        page: ann.page_number,
                        x: ann.bbox.x,
                        y: ann.bbox.y,
                        width: ann.bbox.width,
                        height: ann.bbox.height,
                        html: ann.note || '',
                        redactionRects: ann.bbox.redactionRects
                    });
                }
            });

            console.log('[AnnotationSync] Parsed annotations - Highlights:', newHighlights.length, 'Notes:', newNotes.length, 'Texts:', newTexts.length);
            setHighlights(newHighlights);
            setNotes(newNotes);
            setTextEdits(newTexts);
            backendIdMap.current = newMap;
        } catch (err) {
            console.error('[AnnotationSync] Failed to load annotations:', err);
        }
    };

    // Load on mount/doc change (Replaces polling for simplicity first, but user asked for "synced")
    useEffect(() => {
        loadAnnotations();

        // Simple polling for sync (every 10s)
        const interval = setInterval(loadAnnotations, 10000);
        return () => clearInterval(interval);
    }, [documentId, user]);

    const syncCreate = async (type: 'highlight' | 'note' | 'text', item: any) => {
        console.log('[AnnotationSync] syncCreate called. type:', type, 'documentId:', documentId, 'user:', user?.email);
        if (!documentId || !user) {
            console.log('[AnnotationSync] Skipping create - missing documentId or user');
            return;
        }
        try {
            const payload: AnnotationCreate = {
                document_id: documentId,
                annotation_type: type,
                page_number: item.page,
                bbox: {},
                color: '#FFEB3B'
            };

            if (type === 'highlight') {
                payload.bbox = { rects: item.rects };
                payload.selected_text = item.text;
                payload.color = item.color;
            } else if (type === 'note') {
                payload.bbox = { x: item.x, y: item.y };
                payload.note = item.text;
                payload.color = JSON.stringify(item.color);
            } else if (type === 'text') {
                payload.bbox = { x: item.x, y: item.y, width: item.width, height: item.height, redactionRects: item.redactionRects };
                payload.note = item.html;
            }

            console.log('[AnnotationSync] Creating annotation with payload:', payload);
            const res = await annotationApi.create(payload);
            console.log('[AnnotationSync] Annotation created successfully. Backend ID:', res.id);
            backendIdMap.current.set(item.id, res.id);
        } catch (err) {
            console.error('[AnnotationSync] Sync Create Failed:', err);
        }
    };

    const syncUpdate = async (type: 'note' | 'text', item: any) => {
        if (!documentId || !user) return;
        const backendId = backendIdMap.current.get(item.id);
        if (!backendId) {
            // Check if it's pending? For now, if not found, maybe retry creating?
            // Fallback: create new
            return syncCreate(type, item);
        }

        try {
            const payload: Partial<AnnotationCreate> = {};
            if (type === 'note') {
                payload.bbox = { x: item.x, y: item.y };
                payload.note = item.text;
            } else if (type === 'text') {
                payload.bbox = { x: item.x, y: item.y, width: item.width, height: item.height };
                payload.note = item.html;
            }
            await annotationApi.update(backendId, payload);
        } catch (err) {
            console.error('Sync Update Failed:', err);
        }
    };

    const syncDelete = async (localId: string) => {
        if (!documentId || !user) return;
        const backendId = backendIdMap.current.get(localId);
        if (backendId) {
            try {
                await annotationApi.delete(backendId);
                backendIdMap.current.delete(localId);
            } catch (err) {
                console.error('Sync Delete Failed:', err);
            }
        }
    };

    // Width calc
    // Width calc with animation delay
    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                const sidebarWidth = showThumbnails ? 160 : 0;
                // Subtract sidebar and padding
                setPageWidth(containerRef.current.clientWidth - sidebarWidth - 64);
            }
        };
        const observer = new ResizeObserver(updateWidth);
        if (containerRef.current) observer.observe(containerRef.current);

        // Immediate update
        updateWidth();
        // Update after animation (300ms)
        const timeout = setTimeout(updateWidth, 350);

        return () => {
            observer.disconnect();
            clearTimeout(timeout);
        };
    }, [showThumbnails]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMod = e.metaKey || e.ctrlKey;

            if (isMod && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
            }
            if (e.key === 'Escape') {
                clearAllModes();
                if (onEditModeChange) onEditModeChange(false);
                setActiveTextId(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undoStack, redoStack]);

    // --- Robust Action Logic ---
    const pushAction = useCallback((action: HistoryAction) => {
        setUndoStack(prev => [...prev, action]);
        setRedoStack([]); // Clear redo stack on new action
    }, []);

    const undo = () => {
        if (undoStack.length === 0) return;
        const action = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));
        setRedoStack(prev => [...prev, action]);

        // Safety: ensure arrays exist before filtering/mapping
        switch (action.type) {
            case 'HIGHLIGHT_ADD': setHighlights(prev => prev.filter(h => h.id !== action.payload.id)); break;
            case 'HIGHLIGHT_REMOVE': setHighlights(prev => [...prev, action.payload]); break;
            case 'NOTE_ADD': setNotes(prev => prev.filter(n => n.id !== action.payload.id)); break;
            case 'NOTE_REMOVE': setNotes(prev => [...prev, action.payload]); break;
            case 'NOTE_MOVE': setNotes(prev => prev.map(n => n.id === action.payload.id ? { ...n, x: action.payload.from.x, y: action.payload.from.y } : n)); break;
            case 'NOTE_EDIT': setNotes(prev => prev.map(n => n.id === action.payload.id ? { ...n, text: action.payload.from } : n)); break;
            case 'TEXT_ADD': setTextEdits(prev => prev.filter(t => t.id !== action.payload.id)); break;
            case 'TEXT_REMOVE': setTextEdits(prev => [...prev, action.payload]); break;
            case 'TEXT_MOVE': setTextEdits(prev => prev.map(t => t.id === action.payload.id ? { ...t, x: action.payload.from.x, y: action.payload.from.y } : t)); break;
            case 'TEXT_EDIT': setTextEdits(prev => prev.map(t => t.id === action.payload.id ? { ...t, html: action.payload.from } : t)); break;
        }
    };

    const redo = () => {
        if (redoStack.length === 0) return;
        const action = redoStack[redoStack.length - 1];
        setRedoStack(prev => prev.slice(0, -1));
        setUndoStack(prev => [...prev, action]);

        switch (action.type) {
            case 'HIGHLIGHT_ADD': setHighlights(prev => [...prev, action.payload]); break;
            case 'HIGHLIGHT_REMOVE': setHighlights(prev => prev.filter(h => h.id !== action.payload.id)); break;
            case 'NOTE_ADD': setNotes(prev => [...prev, action.payload]); break;
            case 'NOTE_REMOVE': setNotes(prev => prev.filter(n => n.id !== action.payload.id)); break;
            case 'NOTE_MOVE': setNotes(prev => prev.map(n => n.id === action.payload.id ? { ...n, x: action.payload.to.x, y: action.payload.to.y } : n)); break;
            case 'NOTE_EDIT': setNotes(prev => prev.map(n => n.id === action.payload.id ? { ...n, text: action.payload.to } : n)); break;
            case 'TEXT_ADD': setTextEdits(prev => [...prev, action.payload]); break;
            case 'TEXT_REMOVE': setTextEdits(prev => prev.filter(t => t.id !== action.payload.id)); break;
            case 'TEXT_MOVE': setTextEdits(prev => prev.map(t => t.id === action.payload.id ? { ...t, x: action.payload.to.x, y: action.payload.to.y } : t)); break;
            case 'TEXT_EDIT': setTextEdits(prev => prev.map(t => t.id === action.payload.id ? { ...t, html: action.payload.to } : t)); break;
        }
    };

    // --- Highlighting & Edit Text ---
    const handleTextSelection = () => {
        // Only process if in a text-selection mode
        if (!highlightMode && !editPdfTextMode) return;
        const selection = window.getSelection();
        if (!selection || !selection.toString().trim()) return;

        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        const pageRect = pageRef.current?.getBoundingClientRect();

        if (!pageRect) return;

        const safeRects: Rect[] = Array.from(rects).map(r => ({
            x: (r.left - pageRect.left) / pageRect.width * 100,
            y: (r.top - pageRect.top) / pageRect.height * 100,
            width: r.width / pageRect.width * 100,
            height: r.height / pageRect.height * 100
        }));

        if (highlightMode) {
            // Create highlight
            const highlight: Highlight = {
                id: generateId(),
                page: currentPage,
                text: selection.toString(),
                color: selectedHighlightColor.bg,
                rects: safeRects
            };
            setHighlights(prev => [...prev, highlight]);
            pushAction({ type: 'HIGHLIGHT_ADD', payload: highlight });
            syncCreate('highlight', highlight);
        } else if (editPdfTextMode) {
            const selectedText = selection.toString();

            if (editModeType === 'suggest') {
                // Create suggestion (not direct edit)
                const suggestion: Suggestion = {
                    id: generateId(),
                    page: currentPage,
                    originalText: selectedText,
                    suggestedText: '', // User will fill in
                    rects: safeRects,
                    status: 'pending',
                    createdAt: Date.now()
                };
                setSuggestions(prev => [...prev, suggestion]);
                pushAction({ type: 'SUGGESTION_ADD', payload: suggestion });
                setShowSuggestionsSidebar(true); // Open sidebar
                setEditPdfTextMode(false);

                // Focus the suggestion input after a short delay
                setTimeout(() => {
                    const input = document.getElementById(`suggestion-input-${suggestion.id}`);
                    if (input) input.focus();
                }, 100);
            } else {
                // Direct Edit mode
                const minX = Math.min(...safeRects.map(r => r.x));
                const minY = Math.min(...safeRects.map(r => r.y));
                const maxX = Math.max(...safeRects.map(r => r.x + r.width));
                const maxY = Math.max(...safeRects.map(r => r.y + r.height));

                const textEdit: TextEdit = {
                    id: generateId(),
                    page: currentPage,
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY,
                    html: selectedText,
                    redactionRects: safeRects
                };
                setTextEdits(prev => [...prev, textEdit]);
                pushAction({ type: 'TEXT_ADD', payload: textEdit });
                syncCreate('text', textEdit);
                setEditPdfTextMode(false);

                setTimeout(() => {
                    const el = document.getElementById(`text-edit-${textEdit.id}`);
                    if (el) {
                        el.focus();
                        const range = document.createRange();
                        range.selectNodeContents(el);
                        const sel = window.getSelection();
                        sel?.removeAllRanges();
                        sel?.addRange(range);
                    }
                }, 50);
            }
        }
        selection.removeAllRanges();
    };

    const deleteHighlight = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const hl = highlights.find(h => h.id === id);
        if (hl) {
            pushAction({ type: 'HIGHLIGHT_REMOVE', payload: hl });
            setHighlights(prev => prev.filter(h => h.id !== id));
            syncDelete(id);
        }
    };

    // --- Drag Logic ---
    const handleMouseDown = (e: React.MouseEvent, id: string, type: 'note' | 'text') => {
        if (!pageRef.current) return;
        e.stopPropagation();
        setDraggingId(id);
        setActiveTextId(type === 'text' ? id : null);
        setDragStartPos({ x: e.clientX, y: e.clientY });

        const item = type === 'note' ? notes.find(n => n.id === id) : textEdits.find(t => t.id === id);
        if (item) setItemStartPos({ x: item.x, y: item.y });
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!draggingId || !pageRef.current) return;
        const deltaX = e.clientX - dragStartPos.x;
        const deltaY = e.clientY - dragStartPos.y;
        const rect = pageRef.current.getBoundingClientRect();

        const newX = itemStartPos.x + (deltaX / rect.width) * 100;
        const newY = itemStartPos.y + (deltaY / rect.height) * 100;

        if (notes.some(n => n.id === draggingId)) {
            setNotes(prev => prev.map(n => n.id === draggingId ? { ...n, x: newX, y: newY } : n));
        } else if (textEdits.some(t => t.id === draggingId)) {
            setTextEdits(prev => prev.map(t => t.id === draggingId ? { ...t, x: newX, y: newY } : t));
        }
    }, [draggingId, dragStartPos, itemStartPos, notes, textEdits]);

    const handleMouseUp = useCallback(() => {
        if (draggingId) {
            const note = notes.find(n => n.id === draggingId);
            const text = textEdits.find(t => t.id === draggingId);

            if (note && (note.x !== itemStartPos.x || note.y !== itemStartPos.y)) {
                pushAction({ type: 'NOTE_MOVE', payload: { id: draggingId, from: itemStartPos, to: { x: note.x, y: note.y } } });
                syncUpdate('note', note);
            } else if (text && (text.x !== itemStartPos.x || text.y !== itemStartPos.y)) {
                pushAction({ type: 'TEXT_MOVE', payload: { id: draggingId, from: itemStartPos, to: { x: text.x, y: text.y } } });
                syncUpdate('text', text);
            }
            setDraggingId(null);
        }
    }, [draggingId, notes, textEdits, itemStartPos, pushAction]);

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    // --- Creation ---
    const handlePageClick = (e: React.MouseEvent) => {
        // Always clear active text edit when clicking on the page background (if not clicking an annotation)
        if (!(e.target as HTMLElement).closest('.annotation-item')) {
            setActiveTextId(null);
        }

        if (highlightMode) return;
        // Don't create if clicking on existing item
        if ((e.target as HTMLElement).closest('.annotation-item')) return;
        if (!pageRef.current) return;

        const rect = pageRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width * 100;
        const y = (e.clientY - rect.top) / rect.height * 100;

        if (noteMode) {
            const note: Note = {
                id: generateId(),
                page: currentPage,
                x, y,
                text: '',
                color: selectedNoteColor,
                isOpen: true,
            };
            setNotes(prev => [...prev, note]);
            pushAction({ type: 'NOTE_ADD', payload: note });
            setNoteMode(false);
            syncCreate('note', note);
        } else if (textEditMode) {
            const text: TextEdit = {
                id: generateId(),
                page: currentPage,
                x, y,
                html: ''
            };
            setTextEdits(prev => [...prev, text]);
            pushAction({ type: 'TEXT_ADD', payload: text });
            setTextEditMode(false);
            syncCreate('text', text);

            // Auto focus
            setTimeout(() => {
                const el = document.getElementById(`text-edit-${text.id}`);
                if (el) el.focus();
            }, 50);
        }
    };

    // --- Saving & Download (pdf-lib) ---
    const handleDownload = async () => {
        // Guest Restriction: Require login for download
        const { user } = useAuthStore.getState();
        if (!user) {
            useAppStore.getState().setLoginModalOpen(true);
            return;
        }

        if (!highlights.length && !notes.length && !textEdits.length) return;

        // Revert layout on download
        if (onEditModeChange) onEditModeChange(false);

        try {
            const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
            const response = await api.get(url, { responseType: 'arraybuffer' });
            const existingPdfBytes = response.data;
            const pdfDoc = await PDFDocument.load(existingPdfBytes);
            const pages = pdfDoc.getPages();
            const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

            // 1. Burn Highlights
            highlights.forEach(hl => {
                const pageIndex = hl.page - 1;
                if (pageIndex >= 0 && pageIndex < pages.length) {
                    const page = pages[pageIndex];
                    const { width, height } = page.getSize();

                    hl.rects.forEach(rect => {
                        // Convert % to PDF points (Y is flipped in PDF)
                        const w = (rect.width / 100) * width;
                        const h = (rect.height / 100) * height;
                        const x = (rect.x / 100) * width;
                        const y = height - ((rect.y / 100) * height) - h;

                        // Parse color from rgba/hex (Approximation for now, defaulting to yellow)
                        // A robust solution would parse hl.color string.
                        page.drawRectangle({
                            x, y, width: w, height: h,
                            color: rgb(1, 1, 0), // Yellow
                            opacity: 0.3,
                        });
                    });
                }
            });

            // 2. Burn Text Edits
            textEdits.forEach(text => {
                const pageIndex = text.page - 1;
                if (pageIndex >= 0 && pageIndex < pages.length) {
                    const page = pages[pageIndex];
                    const { width, height } = page.getSize();

                    // Strip HTML tags for PDF
                    const plainText = text.html.replace(/<[^>]+>/g, '') || 'Type...';

                    const x = (text.x / 100) * width;
                    // Adjust Y for text baseline (approximate)
                    const y = height - ((text.y / 100) * height) - 12;

                    page.drawText(plainText, {
                        x, y,
                        size: 12, // Default size
                        font: helveticaFont,
                        color: rgb(0, 0, 0),
                    });
                }
            });

            // 3. Burn Notes (As small yellow squares with text)
            notes.forEach(note => {
                const pageIndex = note.page - 1;
                if (pageIndex >= 0 && pageIndex < pages.length) {
                    const page = pages[pageIndex];
                    const { width, height } = page.getSize();
                    const x = (note.x / 100) * width;
                    const y = height - ((note.y / 100) * height) - 20;

                    // Draw Note Icon Background
                    page.drawRectangle({
                        x, y, width: 20, height: 20,
                        color: rgb(1, 1, 0),
                    });
                    // Note text is too complex to layout fully, just marking the spot
                }
            });

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `annotated_${documentId || 'doc'}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error("Failed to save PDF:", err);
            const msg = getErrorMessage(err);
            alert(`Failed to generate PDF: ${msg}`);
        }
    };

    // --- Click Outside to Close Notes ---
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.annotation-item')) return;
            // Close all notes if clicking on canvas (but not on a note)
            setNotes(prev => prev.map(n => ({ ...n, isOpen: false })));
        };

        // Attach to the page container to capture clicks on the PDF background
        const container = pageRef.current?.parentElement;
        if (container) {
            container.addEventListener('click', handleClickOutside); // Use capture?
        }
        // Also attach to window for general clicks outside
        window.addEventListener('click', handleClickOutside);

        return () => {
            if (container) container.removeEventListener('click', handleClickOutside);
            window.removeEventListener('click', handleClickOutside);
        };
    }, []);

    // --- Rich Text Handlers ---
    const executeCommand = (command: string, value: string = '') => {
        if (!activeTextId) return;
        const el = document.getElementById(`text-edit-${activeTextId}`);
        if (!el) return;

        const oldHtml = el.innerHTML;
        document.execCommand(command, false, value);
        const newHtml = el.innerHTML;

        setTextEdits(prev => prev.map(t => t.id === activeTextId ? { ...t, html: newHtml } : t));
        if (oldHtml !== newHtml) {
            pushAction({ type: 'TEXT_EDIT', payload: { id: activeTextId, from: oldHtml, to: newHtml } });
        }
    };

    const handleTextBlur = (id: string, oldHtml: string, newHtml: string) => {
        setTextEdits(prev => prev.map(t => t.id === id ? { ...t, html: newHtml } : t));
        if (oldHtml !== newHtml) {
            pushAction({ type: 'TEXT_EDIT', payload: { id, from: oldHtml, to: newHtml } });
            const item = textEdits.find(t => t.id === id);
            if (item) {
                syncUpdate('text', { ...item, html: newHtml });
            }
        }
        if (!newHtml.trim()) deleteItem(id, 'text');
    };

    const deleteItem = (id: string, type: 'note' | 'text') => {
        if (type === 'note') {
            const item = notes.find(n => n.id === id);
            if (item) {
                setNotes(prev => prev.filter(n => n.id !== id));
                pushAction({ type: 'NOTE_REMOVE', payload: item });
                syncDelete(id);
            }
        } else {
            const item = textEdits.find(t => t.id === id);
            if (item) {
                setTextEdits(prev => prev.filter(t => t.id !== id));
                pushAction({ type: 'TEXT_REMOVE', payload: item });
                syncDelete(id);
                if (activeTextId === id) setActiveTextId(null);
            }
        }
    };

    // --- Suggestion Handlers ---
    const acceptSuggestion = (id: string) => {
        const suggestion = suggestions.find(s => s.id === id);
        if (!suggestion) return;

        // Convert suggestion to actual text edit
        const minX = Math.min(...suggestion.rects.map(r => r.x));
        const minY = Math.min(...suggestion.rects.map(r => r.y));
        const maxX = Math.max(...suggestion.rects.map(r => r.x + r.width));
        const maxY = Math.max(...suggestion.rects.map(r => r.y + r.height));

        const textEdit: TextEdit = {
            id: generateId(),
            page: suggestion.page,
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            html: suggestion.suggestedText || suggestion.originalText,
            redactionRects: suggestion.rects
        };

        setTextEdits(prev => [...prev, textEdit]);
        setSuggestions(prev => prev.map(s => s.id === id ? { ...s, status: 'accepted' as const } : s));
        pushAction({ type: 'SUGGESTION_ACCEPT', payload: suggestion });
    };

    const rejectSuggestion = (id: string) => {
        const suggestion = suggestions.find(s => s.id === id);
        if (!suggestion) return;

        setSuggestions(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected' as const } : s));
        pushAction({ type: 'SUGGESTION_REJECT', payload: suggestion });
    };

    const updateSuggestionText = (id: string, newText: string) => {
        setSuggestions(prev => prev.map(s => s.id === id ? { ...s, suggestedText: newText } : s));
    };

    const deleteSuggestion = (id: string) => {
        const suggestion = suggestions.find(s => s.id === id);
        if (suggestion) {
            setSuggestions(prev => prev.filter(s => s.id !== id));
            pushAction({ type: 'SUGGESTION_REMOVE', payload: suggestion });
        }
    };

    const clearAllModes = () => {
        setHighlightMode(false);
        setNoteMode(false);
        setTextEditMode(false);
        setEditPdfTextMode(false);
        setShowEditDropdown(false);
    };

    const handleGoToPage = (newPage: number) => {
        if (newPage >= 1 && newPage <= numPages) {
            setCurrentPage(newPage);
        }
    };

    // Filter per page
    const activeHighlights = highlights.filter(h => h.page === currentPage);
    const activeNotes = notes.filter(n => n.page === currentPage);
    const activeTexts = textEdits.filter(t => t.page === currentPage);
    const activeSuggestions = suggestions.filter(s => s.page === currentPage && s.status === 'pending');
    const pendingSuggestions = suggestions.filter(s => s.status === 'pending');

    if (!isClient) return <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin" /></div>;
    return (
        <div ref={containerRef} className="flex h-full bg-gray-100 rounded-lg overflow-hidden relative border border-gray-300">
            {/* ... styles ... */}
            <style jsx global>{`
                ::selection { background: ${selectedHighlightColor.bg}; color: inherit; }
                /* Removed @media print since print button is gone */
            `}</style>

            {/* Sidebar (Unchanged) */}
            <AnimatePresence>
                {showThumbnails && (
                    <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 160, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="bg-gray-100 border-r border-gray-200 overflow-y-auto overflow-x-hidden flex flex-col gap-4 p-4 no-print h-full"
                    >
                        <Document file={url} className="flex flex-col gap-4 items-center" loading={<div className="p-4 text-center text-xs text-gray-500">Loading Thumbnails...</div>}>
                            {numPages > 0 && Array.from(new Array(numPages), (el, index) => {
                                const pageNum = index + 1;
                                const pageHighlights = highlights.filter(h => h.page === pageNum);
                                const pageNotes = notes.filter(n => n.page === pageNum);
                                const pageTexts = textEdits.filter(t => t.page === pageNum);

                                return (
                                    <div
                                        key={`thumb_${pageNum}`}
                                        className={`relative cursor-pointer transition-all hover:ring-2 rounded-sm overflow-hidden ${currentPage === pageNum ? 'ring-blue-500 ring-offset-1' : 'ring-transparent hover:ring-gray-300'}`}
                                        onClick={() => handleGoToPage(pageNum)}
                                    >
                                        <Page
                                            pageNumber={pageNum}
                                            width={120}
                                            renderTextLayer={false}
                                            renderAnnotationLayer={false}
                                            onLoadError={() => { }}
                                            loading={<div className="w-[120px] h-[155px] bg-slate-200 animate-pulse" />}
                                        />
                                        {/* Annotation overlays on thumbnails */}
                                        <div className="absolute inset-0 pointer-events-none">
                                            {/* Highlight overlays */}
                                            {pageHighlights.map(hl => (
                                                hl.rects.map((rect, i) => (
                                                    <div
                                                        key={`thumb-hl-${hl.id}-${i}`}
                                                        className="absolute mix-blend-multiply"
                                                        style={{
                                                            left: `${rect.x}%`,
                                                            top: `${rect.y}%`,
                                                            width: `${rect.width}%`,
                                                            height: `${rect.height}%`,
                                                            backgroundColor: hl.color,
                                                        }}
                                                    />
                                                ))
                                            ))}
                                            {/* Note indicators */}
                                            {pageNotes.map(note => (
                                                <div
                                                    key={`thumb-note-${note.id}`}
                                                    className="absolute w-2 h-2 rounded-full shadow-sm"
                                                    style={{
                                                        left: `${note.x}%`,
                                                        top: `${note.y}%`,
                                                        backgroundColor: note.color.bg,
                                                        border: `1px solid ${note.color.border}`,
                                                    }}
                                                />
                                            ))}
                                            {/* Text edit indicators */}
                                            {pageTexts.map(text => (
                                                <div
                                                    key={`thumb-text-${text.id}`}
                                                    className="absolute bg-blue-400/50 border border-blue-500/50"
                                                    style={{
                                                        left: `${text.x}%`,
                                                        top: `${text.y}%`,
                                                        width: text.width ? `${text.width}%` : '8%',
                                                        height: text.height ? `${text.height}%` : '2%',
                                                        minWidth: '4px',
                                                        minHeight: '2px',
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <div className="absolute active:scale-95 inset-0 bg-transparent pointer-events-none" />
                                        <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] px-1 rounded-tl-md backdrop-blur-sm">
                                            {pageNum}
                                        </span>
                                    </div>
                                );
                            })}
                        </Document>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className={`flex-1 flex flex-col min-w-0 bg-gray-100/50`}>
                {/* Toolbar */}
                <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 shadow-sm z-10 no-print">
                    <button onClick={() => setShowThumbnails(!showThumbnails)} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-900" title={showThumbnails ? "Hide Thumbnails" : "Show Thumbnails"}>
                        {showThumbnails ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>

                    <div className="w-px h-6 bg-gray-300 mx-1" />

                    <div className="flex bg-gray-100 rounded-lg p-1 gap-1 border border-gray-200">
                        <button onClick={() => {
                            clearAllModes();
                            setHighlightMode(!highlightMode);
                            if (!highlightMode && onEditModeChange) onEditModeChange(true);
                        }} className={`p-2 rounded-md transition-all ${highlightMode ? 'bg-yellow-200 text-yellow-900 border border-yellow-400' : 'hover:bg-white text-gray-900'}`} title="Highlight">
                            <Highlighter size={16} />
                        </button>
                        <button onClick={() => {
                            clearAllModes();
                            setNoteMode(!noteMode);
                            if (!noteMode && onEditModeChange) onEditModeChange(true);
                        }} className={`p-2 rounded-md transition-all ${noteMode ? 'bg-blue-200 text-blue-900 border border-blue-400' : 'hover:bg-white text-gray-900'}`} title="Add Note">
                            <StickyNote size={16} />
                        </button>
                        <button onClick={() => {
                            clearAllModes();
                            setTextEditMode(!textEditMode);
                            if (!textEditMode && onEditModeChange) onEditModeChange(true);
                        }} className={`p-2 rounded-md transition-all ${textEditMode ? 'bg-purple-200 text-purple-900 border border-purple-400' : 'hover:bg-white text-gray-900'}`} title="Add Text">
                            <Type size={16} />
                        </button>

                        {/* Edit Mode Dropdown */}
                        <div className="relative">
                            <button
                                onClick={() => setShowEditDropdown(!showEditDropdown)}
                                className={`p-2 rounded-md transition-all flex items-center gap-1 ${editPdfTextMode ? (editModeType === 'suggest' ? 'bg-orange-200 text-orange-900 border border-orange-400' : 'bg-green-200 text-green-900 border border-green-400') : 'hover:bg-white text-gray-900'}`}
                                title="Edit PDF Text"
                            >
                                <Pencil size={16} />
                                <ChevronDown size={12} />
                            </button>

                            <AnimatePresence>
                                {showEditDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -8 }}
                                        className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-50 min-w-[160px]"
                                    >
                                        <button
                                            onClick={() => {
                                                clearAllModes();
                                                setEditModeType('edit');
                                                setEditPdfTextMode(true);
                                            }}
                                            className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 ${editModeType === 'edit' && editPdfTextMode ? 'bg-green-50 text-green-700' : 'text-gray-700'}`}
                                        >
                                            <Pencil size={14} />
                                            <span className="font-medium">Edit</span>
                                            <span className="text-[10px] text-gray-400 ml-auto">Direct replace</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                clearAllModes();
                                                setEditModeType('suggest');
                                                setEditPdfTextMode(true);
                                            }}
                                            className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100 ${editModeType === 'suggest' && editPdfTextMode ? 'bg-orange-50 text-orange-700' : 'text-gray-700'}`}
                                        >
                                            <MessageSquarePlus size={14} />
                                            <span className="font-medium">Suggest Edit</span>
                                            <span className="text-[10px] text-gray-400 ml-auto">Track changes</span>
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Suggestions Sidebar Toggle */}
                        {pendingSuggestions.length > 0 && (
                            <button
                                onClick={() => setShowSuggestionsSidebar(!showSuggestionsSidebar)}
                                className={`p-2 rounded-md transition-all relative ${showSuggestionsSidebar ? 'bg-orange-200 text-orange-900' : 'hover:bg-white text-gray-900'}`}
                                title="View Suggestions"
                            >
                                <MessageSquarePlus size={16} />
                                <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                                    {pendingSuggestions.length}
                                </span>
                            </button>
                        )}
                    </div>

                    {/* Formatting Tools (Unchanged) */}
                    {activeTextId && (
                        <div className="flex items-center gap-1 bg-white border border-gray-300 shadow-sm rounded-lg px-2 py-1 ml-2 animate-in fade-in slide-in-from-top-1">
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => executeCommand('bold')} className="p-1.5 hover:bg-gray-100 rounded text-black font-bold border border-transparent hover:border-gray-200" title="Bold"><Bold size={14} /></button>
                            <button onMouseDown={(e) => e.preventDefault()} onClick={() => executeCommand('italic')} className="p-1.5 hover:bg-gray-100 rounded text-black italic border border-transparent hover:border-gray-200" title="Italic"><Italic size={14} /></button>
                            <div className="w-px h-4 bg-gray-300 mx-1" />
                            <div className="flex items-center gap-0.5">
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => executeCommand('fontSize', '3')} className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 rounded text-black font-semibold text-xs border border-transparent hover:border-gray-200">A</button>
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => executeCommand('fontSize', '5')} className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 rounded text-black font-bold text-sm border border-transparent hover:border-gray-200">A</button>
                                <button onMouseDown={(e) => e.preventDefault()} onClick={() => executeCommand('fontSize', '7')} className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 rounded text-black font-extrabold text-lg border border-transparent hover:border-gray-200">A</button>
                            </div>
                        </div>
                    )}

                    <div className="flex-1" />

                    {/* Zoom & Nav (Unchanged) */}
                    <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-300 p-1 shadow-sm">
                        <button onClick={() => handleGoToPage(currentPage - 1)} disabled={currentPage <= 1} className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-40 text-black"><ChevronLeft size={16} /></button>
                        <span className="px-2 text-sm font-bold w-16 text-center text-black">{currentPage} / {numPages}</span>
                        <button onClick={() => handleGoToPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-40 text-black"><ChevronRight size={16} /></button>
                    </div>

                    <div className="flex items-center gap-1 ml-2 bg-white rounded-lg border border-gray-300 p-1 shadow-sm">
                        <button onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} className="p-1.5 hover:bg-gray-100 rounded text-black"><ZoomOut size={16} /></button>
                        <span className="w-12 text-center text-sm font-bold text-black">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => setZoom(Math.min(3, zoom + 0.25))} className="p-1.5 hover:bg-gray-100 rounded text-black"><ZoomIn size={16} /></button>
                    </div>

                    <div className="w-px h-6 bg-gray-300 mx-2" />

                    <div className="flex gap-1">
                        <button onClick={() => undo()} disabled={undoStack.length === 0} className="p-2 rounded-lg hover:bg-gray-200 text-gray-900 transition-colors disabled:opacity-30" title="Undo"><Undo2 size={18} /></button>
                        <button onClick={() => redo()} disabled={redoStack.length === 0} className="p-2 rounded-lg hover:bg-gray-200 text-gray-900 transition-colors disabled:opacity-30" title="Redo"><Redo2 size={18} /></button>
                    </div>

                    <div className="w-px h-6 bg-gray-300 mx-2" />

                    {/* Save Changes Button (Exits Edit Mode) */}
                    {(highlights.length > 0 || notes.length > 0 || textEdits.length > 0) && (
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    clearAllModes();
                                    // Keep layout expanded for download
                                    // if (onEditModeChange) onEditModeChange(false);
                                    setActiveTextId(null);

                                    // Trigger 'Saved' animation
                                    setIsSaved(true);
                                    setTimeout(() => setIsSaved(false), 2000);
                                }}
                                className={`p-2 rounded-lg transition-all flex items-center gap-2 shadow-sm animate-in fade-in zoom-in ${isSaved
                                    ? 'bg-green-100 text-green-700 border border-green-200'
                                    : 'bg-green-600 hover:bg-green-700 text-white'
                                    }`}
                                title="Save changes"
                            >
                                {isSaved ? <CheckCircle2 size={18} /> : <Check size={18} />}
                                <span className={`text-sm font-semibold hidden md:inline ${isSaved ? 'text-green-700' : 'text-white'}`}>
                                    {isSaved ? 'Saved!' : 'Save'}
                                </span>
                            </button>

                            {/* Download PDF Button */}
                            <button
                                onClick={handleDownload}
                                className="p-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors flex items-center gap-2 shadow-sm animate-in fade-in zoom-in"
                                title="Download Annotated PDF"
                            >
                                <Download size={18} />
                                <span className="text-sm font-semibold hidden lg:inline">Download</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* PDF Canvas area */}
                <div className="flex-1 overflow-auto flex justify-center p-8 relative annotation-container bg-slate-200/50">
                    {/* Active Citation Badge */}
                    <AnimatePresence>
                        {activeCitation && activeCitation.page === currentPage && (
                            <motion.div
                                initial={{ opacity: 0, y: -20, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -20, scale: 0.9 }}
                                className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg border border-blue-500 flex items-center gap-2 max-w-lg pointer-events-none"
                            >
                                <div className="p-1 rounded-full bg-white/20">
                                    <Sparkles size={12} className="text-yellow-300 fill-yellow-300" />
                                </div>
                                <div className="text-sm font-medium truncate max-w-[300px]">
                                    {activeCitation.text ? `"${activeCitation.text}"` : 'Reference found on this page'}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <Document
                        file={url}
                        onLoadSuccess={({ numPages }) => { setNumPages(numPages); }}
                        onLoadError={(err) => console.error("Main PDF Load Error:", err)}
                        loading={<Loader2 className="animate-spin text-blue-600 mt-10" />}
                        error={
                            <div className="flex flex-col items-center justify-center mt-20 text-red-500">
                                <p className="font-bold text-lg mb-2">Failed to load PDF</p>
                                <p className="text-sm opacity-80">Please check your network connection or the document URL.</p>
                            </div>
                        }
                    >
                        <div
                            ref={pageRef}
                            className="relative bg-white shadow-xl transition-shadow border border-gray-100"
                            onClick={handlePageClick}
                            onMouseUp={handleTextSelection}
                            style={{
                                cursor: (highlightMode || editPdfTextMode) ? 'text' : (noteMode || textEditMode ? 'crosshair' : 'default'),
                                outline: (noteMode || textEditMode) ? '2px dashed #2563eb' : (editPdfTextMode ? '2px dashed #16a34a' : 'none'),
                                outlineOffset: '4px'
                            }}
                        >
                            <Page
                                pageNumber={currentPage}
                                width={pageWidth * zoom}
                                renderTextLayer={true}
                                renderAnnotationLayer={false}
                                loading=""
                            />

                            {/* Highlights */}
                            {activeHighlights.map(hl => (
                                <div key={hl.id} className="absolute inset-0 pointer-events-none">
                                    {hl.rects.map((rect, i) => (
                                        <div
                                            key={i}
                                            className="absolute group pointer-events-auto cursor-pointer mix-blend-multiply hover:opacity-80"
                                            style={{
                                                left: `${rect.x}%`,
                                                top: `${rect.y}%`,
                                                width: `${rect.width}%`,
                                                height: `${rect.height}%`,
                                                backgroundColor: hl.color
                                            }}
                                        >
                                            <button
                                                onClick={(e) => deleteHighlight(hl.id, e)}
                                                className="absolute -top-3 -right-3 bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-all scale-75 hover:scale-100 z-50 shadow-sm no-print"
                                                title="Remove highlight"
                                            >
                                                <X size={10} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ))}

                            {/* Sticky Notes */}
                            {activeNotes.map(note => (
                                <div
                                    key={note.id}
                                    className="absolute group z-20"
                                    style={{ left: `${note.x}%`, top: `${note.y}%` }}
                                >
                                    <div
                                        className={`relative transition-all duration-200 ease-in-out annotation-item ${note.isOpen ? 'w-64' : 'w-8 h-8'}`}
                                        onMouseDown={(e) => handleMouseDown(e, note.id, 'note')}
                                    >
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setNotes(prev => prev.map(n => n.id === note.id ? { ...n, isOpen: !n.isOpen } : n)); }}
                                            className={`absolute top-0 left-0 p-2 rounded-full shadow-md z-30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-grab active:cursor-grabbing border border-gray-300`}
                                            style={{ backgroundColor: note.color.bg, borderColor: note.color.border }}
                                        >
                                            <StickyNote size={16} color={note.color.text} />
                                        </button>

                                        <AnimatePresence>
                                            {note.isOpen && (
                                                <motion.div
                                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.9 }}
                                                    className="absolute top-8 left-0 p-3 rounded-lg shadow-xl border z-20 backdrop-blur-sm"
                                                    style={{ backgroundColor: note.color.bg + 'F0', borderColor: note.color.border }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                >
                                                    <textarea
                                                        className="w-full bg-transparent resize-y min-h-[100px] text-sm focus:outline-none focus:ring-1 focus:ring-black/20 rounded font-medium"
                                                        style={{ color: note.color.text }}
                                                        placeholder="Write a note..."
                                                        value={note.text}
                                                        onChange={(e) => setNotes(prev => prev.map(n => n.id === note.id ? { ...n, text: e.target.value } : n))}
                                                        autoFocus={!note.text}
                                                    />
                                                    <div className="flex justify-between items-center pt-2 border-t border-black/10 mt-1">
                                                        <span className="text-[10px] uppercase tracking-wider font-bold opacity-70" style={{ color: note.color.text }}>Note</span>
                                                        <button onClick={() => deleteItem(note.id, 'note')} className="text-red-500 hover:bg-red-50 p-1.5 rounded-full transition-colors no-print"><Trash2 size={14} /></button>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </div>
                            ))}

                            {/* Rich Text Edits - with redaction rectangles */}
                            {activeTexts.map(text => (
                                <div key={text.id} className="annotation-item">
                                    {/* Redaction: White rectangles covering original text */}
                                    {text.redactionRects?.map((rect, i) => (
                                        <div
                                            key={`redact-${text.id}-${i}`}
                                            className="absolute z-20"
                                            style={{
                                                left: `${rect.x}%`,
                                                top: `${rect.y}%`,
                                                width: `${rect.width}%`,
                                                height: `${rect.height}%`,
                                                backgroundColor: '#ffffff'
                                            }}
                                        />
                                    ))}

                                    {/* Editable text overlay - positioned precisely over original */}
                                    <div
                                        className="absolute z-30"
                                        style={{
                                            left: `${text.x}%`,
                                            top: `${text.y}%`,
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveTextId(text.id);
                                            if (onEditModeChange) onEditModeChange(true);
                                        }}
                                    >
                                        {/* Wrapper for controls */}
                                        <div className={`relative group transition-all ${activeTextId === text.id ? 'z-50' : 'z-30 hover:z-40'}`}>

                                            {/* Floating Toolbar - Centered above */}
                                            {activeTextId === text.id && (
                                                <div
                                                    className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white rounded-md shadow-md border border-gray-200 p-1 no-print z-50 animate-in fade-in zoom-in-95 duration-100"
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                >
                                                    {/* Drag Handle */}
                                                    <div
                                                        className="cursor-move p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-blue-600 flex items-center"
                                                        onMouseDown={(e) => handleMouseDown(e, text.id, 'text')}
                                                        title="Drag to move"
                                                    >
                                                        <Move size={14} />
                                                    </div>

                                                    <div className="w-px h-3 bg-gray-200 mx-1" />

                                                    {/* Delete Button */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); deleteItem(text.id, 'text'); }}
                                                        className="p-1 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded flex items-center"
                                                        title="Delete"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Resizable container */}
                                            <div
                                                style={{
                                                    width: text.width ? `${(text.width / 100) * (pageRef.current?.offsetWidth || 800)}px` : 'auto',
                                                    height: text.height ? `${(text.height / 100) * (pageRef.current?.offsetHeight || 800)}px` : 'auto',
                                                    minWidth: '50px',
                                                    minHeight: '24px',
                                                    resize: activeTextId === text.id ? 'both' : 'none',
                                                    overflow: activeTextId === text.id ? 'auto' : 'hidden',
                                                }}
                                                className={`
                                                    rounded-sm transition-all duration-200
                                                    ${activeTextId === text.id
                                                        ? 'border border-blue-500 bg-white ring-2 ring-blue-500/10'
                                                        : 'border border-transparent hover:border-blue-200/50 bg-transparent'
                                                    }
                                                `}
                                            >
                                                <div
                                                    id={`text-edit-${text.id}`}
                                                    contentEditable
                                                    suppressContentEditableWarning
                                                    className={`outline-none w-full h-full min-h-[20px] transition-colors ${activeTextId === text.id ? 'cursor-text' : 'cursor-default'}`}
                                                    style={{
                                                        fontSize: text.height
                                                            ? `${(text.height / 100) * (pageRef.current?.offsetHeight || 800) * 0.85}px`
                                                            : '14px',
                                                        lineHeight: 1.2,
                                                        color: '#000000',
                                                        backgroundColor: 'transparent',
                                                        padding: '4px',
                                                        margin: 0,
                                                        display: 'block',
                                                        wordWrap: 'break-word',
                                                        whiteSpace: 'pre-wrap',
                                                    }}
                                                    dangerouslySetInnerHTML={{ __html: text.html }}
                                                    onFocus={(e) => {
                                                        setActiveTextId(text.id);
                                                        e.currentTarget.dataset.prev = text.html;
                                                    }}
                                                    onBlur={(e) => {
                                                        const prev = e.currentTarget.dataset.prev || '';
                                                        handleTextBlur(text.id, prev, e.currentTarget.innerHTML);
                                                        // Don't clear active ID here immediately to avoid flickering UI when clicking controls
                                                    }}
                                                />

                                                {/* Controls from here handled by floating toolbar */}

                                                {/* Resize handle indicator - Only visible when active */}
                                                {activeTextId === text.id && (
                                                    <div className="absolute bottom-0 right-0 w-3 h-3 pointer-events-none">
                                                        <div className="w-full h-full border-r-2 border-b-2 border-blue-500/50" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Suggestion Strikethroughs (Google Docs style) */}
                            {activeSuggestions.map(suggestion => (
                                <div key={suggestion.id} className="absolute inset-0 pointer-events-none">
                                    {suggestion.rects.map((rect, i) => (
                                        <div
                                            key={i}
                                            className="absolute"
                                            style={{
                                                left: `${rect.x}%`,
                                                top: `${rect.y}%`,
                                                width: `${rect.width}%`,
                                                height: `${rect.height}%`,
                                            }}
                                        >
                                            {/* Strikethrough line */}
                                            <div
                                                className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500"
                                                style={{ transform: 'translateY(-50%)' }}
                                            />
                                            {/* Light red background */}
                                            <div className="absolute inset-0 bg-red-100/50" />
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </Document>
                </div>

                {/* Compact Suggestions Sidebar */}
                <AnimatePresence>
                    {showSuggestionsSidebar && pendingSuggestions.length > 0 && (
                        <motion.div
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 220, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            className="bg-gray-50 border-l border-gray-200 overflow-y-auto flex flex-col no-print"
                        >
                            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between bg-white">
                                <span className="text-xs font-semibold text-gray-700">
                                    Edits ({pendingSuggestions.length})
                                </span>
                                <button
                                    onClick={() => setShowSuggestionsSidebar(false)}
                                    className="p-0.5 hover:bg-gray-100 rounded"
                                >
                                    <X size={14} className="text-gray-400" />
                                </button>
                            </div>

                            <div className="flex-1 p-2 space-y-2">
                                {pendingSuggestions.map(suggestion => (
                                    <div
                                        key={suggestion.id}
                                        className="bg-white border border-gray-200 rounded p-2 shadow-sm text-xs"
                                    >
                                        <div className="text-[10px] text-gray-400 mb-1">p.{suggestion.page}</div>

                                        {/* Original → New inline */}
                                        <div className="flex items-center gap-1 mb-1.5">
                                            <span className="line-through text-red-500 truncate max-w-[70px]" title={suggestion.originalText}>
                                                {suggestion.originalText}
                                            </span>
                                            <span className="text-gray-400">→</span>
                                            <input
                                                id={`suggestion-input-${suggestion.id}`}
                                                type="text"
                                                value={suggestion.suggestedText}
                                                onChange={(e) => updateSuggestionText(suggestion.id, e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && suggestion.suggestedText.trim()) {
                                                        acceptSuggestion(suggestion.id);
                                                    }
                                                    if (e.key === 'Escape') {
                                                        deleteSuggestion(suggestion.id);
                                                    }
                                                }}
                                                placeholder="New text"
                                                className="flex-1 text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-200 focus:outline-none focus:ring-1 focus:ring-green-300 min-w-0"
                                            />
                                        </div>

                                        <div className="text-[9px] text-gray-400">
                                            Press Enter to apply, Esc to cancel
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

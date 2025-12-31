'use client';

/**
 * Document Library Component
 * Lists and manages uploaded documents
 */
import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Upload,
    FileText,
    Search,
    Trash2,
    Clock,
    CheckCircle,
    Loader2,
    AlertCircle,
    MoreVertical,
    ChevronRight,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { documentApi, Document } from '@/lib/api';
import { useAppStore } from '@/store';

interface DocumentLibraryProps {
    onDocumentSelect: (doc: Document) => void;
    variant?: 'sidebar' | 'hero';
    hideUpload?: boolean;
}

export default function DocumentLibrary({ onDocumentSelect, variant = 'sidebar', hideUpload = false }: DocumentLibraryProps) {
    const { documents, setDocuments, addDocument, removeDocument, addGuestDocId, currentDocument, setCurrentDocument } = useAppStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

    // Duplicate Handling State
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [duplicateDocId, setDuplicateDocId] = useState<number | null>(null);

    const processUpload = useCallback(async (file: File) => {
        setIsUploading(true);
        setUploadProgress(0);

        try {
            // Simulate progress
            const progressInterval = setInterval(() => {
                setUploadProgress((prev) => Math.min(prev + 10, 90));
            }, 200);

            const doc = await documentApi.upload(file);

            clearInterval(progressInterval);
            setUploadProgress(100);

            addDocument(doc);
            addGuestDocId(doc.id);

            // If in hero mode, automatically select the document
            if (variant === 'hero') {
                pollDocumentStatus(doc.id);
                onDocumentSelect(doc);
            } else {
                pollDocumentStatus(doc.id);
            }

        } catch (error) {
            console.error('Upload failed:', error);
        } finally {
            setTimeout(() => {
                setIsUploading(false);
                setUploadProgress(0);
                setPendingFile(null);
                setDuplicateDocId(null);
            }, 500);
        }
    }, [addDocument, onDocumentSelect, variant, addGuestDocId]);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;

        // Check for duplicates
        const existingDoc = documents.find(d => d.original_filename === file.name);
        if (existingDoc) {
            setPendingFile(file);
            setDuplicateDocId(existingDoc.id);
            return;
        }

        await processUpload(file);
    }, [documents, processUpload]);

    const handleReplace = async () => {
        if (!pendingFile || !duplicateDocId) return;

        // Delete existing first
        try {
            await documentApi.delete(duplicateDocId);
            removeDocument(duplicateDocId);
            // If replaced doc was active, we don't necessarily need to clear it since we'll open the new one, 
            // but clearing ensures UI state is clean.
            if (currentDocument?.id === duplicateDocId) {
                setCurrentDocument(null);
            }
        } catch (err) {
            console.error('Failed to delete existing for replace:', err);
        }

        // Proceed with upload
        await processUpload(pendingFile);
    };

    const handleKeepBoth = async () => {
        if (!pendingFile) return;
        // Just upload, backend or logic will handle new ID. 
        // Note: filenames might be same visually but IDs differ.
        await processUpload(pendingFile);
    };

    const cancelUpload = () => {
        setPendingFile(null);
        setDuplicateDocId(null);
    };

    const pollDocumentStatus = async (docId: number) => {
        const checkStatus = async () => {
            try {
                const doc = await documentApi.get(docId);
                const { updateDocument } = useAppStore.getState();
                updateDocument(docId, doc);

                // Continue polling while still processing (either uploaded or processing state)
                if (doc.status === 'uploaded' || doc.status === 'processing') {
                    setTimeout(checkStatus, 2000);
                }
            } catch (err: any) {
                // Stop polling if document was deleted (404)
                if (err?.response?.status === 404) {
                    console.log(`Document ${docId} was deleted, stopping poll`);
                    return;
                }
                console.error('Status check failed:', err);
                // Retry on other errors
                setTimeout(checkStatus, 3000);
            }
        };

        setTimeout(checkStatus, 1000);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'application/pdf': ['.pdf'] },
        maxFiles: 1,
        maxSize: 50 * 1024 * 1024, // 50MB
    });

    const handleDeleteClick = (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteConfirmId(id);
    };

    const confirmDelete = async () => {
        if (deleteConfirmId === null) return;

        try {
            await documentApi.delete(deleteConfirmId);
            removeDocument(deleteConfirmId);

            // If the deleted document is the current one, return to home
            if (currentDocument?.id === deleteConfirmId) {
                setCurrentDocument(null);
            }
        } catch (err) {
            console.error('Delete failed:', err);
        } finally {
            setDeleteConfirmId(null);
        }
    };

    const cancelDelete = () => {
        setDeleteConfirmId(null);
    };

    const filteredDocuments = documents.filter((doc) =>
        doc.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getStatusIcon = (status: Document['status']) => {
        switch (status) {
            case 'uploaded':
            case 'processing':
                return <Loader2 size={16} className="animate-spin text-[var(--warning)]" />;
            case 'ready':
                return <CheckCircle size={16} className="text-[var(--success)]" />;
            case 'failed':
                return (
                    <span title="Processing failed" className="flex items-center">
                        <AlertCircle size={16} className="text-[var(--error)]" />
                    </span>
                );
        }
    };

    const getStatusText = (status: Document['status']) => {
        switch (status) {
            case 'uploaded':
                return 'Uploaded';
            case 'processing':
                return 'Processing...';
            case 'ready':
                return 'Ready';
            case 'failed':
                return 'Failed';
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (date: string) => {
        let d = date;
        if (d && !d.endsWith('Z') && !d.includes('+')) d += 'Z';
        return new Date(d).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    if (variant === 'hero') {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full max-w-4xl mx-auto p-8">
                <div className="text-center mb-10">
                    <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6 text-blue-600 shadow-lg shadow-blue-500/10">
                        <Upload size={40} />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Upload a Document</h1>
                    <p className="text-slate-500 text-lg">
                        Drag & drop a PDF to start chatting with your AI document assistant.
                    </p>
                </div>

                <div
                    {...getRootProps()}
                    className={`
                        w-full max-w-2xl p-12 border-3 border-dashed rounded-2xl cursor-pointer transition-all duration-300
                        flex flex-col items-center justify-center bg-white shadow-sm hover:shadow-lg hover:-translate-y-1
                        ${isDragActive
                            ? 'border-blue-500 bg-blue-50/50 scale-[1.02]'
                            : 'border-slate-200 hover:border-blue-400'
                        }
                    `}
                >
                    <input {...getInputProps()} />
                    {isUploading ? (
                        <div className="text-center w-full max-w-xs">
                            <Loader2 size={48} className="animate-spin mx-auto mb-4 text-blue-600" />
                            <p className="text-lg font-medium text-slate-900 mb-2">Analyzing Document...</p>
                            <p className="text-sm text-slate-500 mb-4">{uploadProgress}% Complete</p>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full bg-blue-600 rounded-full"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="text-center">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400 group-hover:text-blue-500 transition-colors">
                                <FileText size={32} />
                            </div>
                            <p className="text-xl font-semibold text-slate-900 mb-2">
                                Click or Drag PDF Here
                            </p>
                            <p className="text-slate-400">
                                Supports PDF up to 50MB
                            </p>
                        </div>
                    )}
                </div>

                {/* Recent Files in Hero Mode */}
                {documents.length > 0 && (
                    <div className="w-full max-w-2xl mt-12">
                        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Recent Documents</h3>
                        <div className="grid grid-cols-1 gap-3">
                            {documents.slice(0, 3).map((doc) => (
                                <div
                                    key={doc.id}
                                    onClick={() => doc.status === 'ready' && onDocumentSelect(doc)}
                                    className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:shadow-md cursor-pointer transition-all group"
                                    title={doc.status === 'ready' ? "Open Document" : "Processing..."}
                                >
                                    <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 group-hover:text-blue-600 group-hover:bg-blue-50 transition-colors">
                                        <FileText size={20} />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-medium text-slate-900 group-hover:text-blue-700 transition-colors">{doc.original_filename}</h4>
                                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                                            <span>{formatFileSize(doc.file_size)}</span>
                                            <span>•</span>
                                            <span>{formatDate(doc.created_at)}</span>
                                        </div>
                                    </div>
                                    <ChevronRight size={18} className="text-slate-300 group-hover:text-blue-500" />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Sidebar Variant (Existing Layout)
    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-[var(--border)]">
                <h2 className="text-lg font-semibold mb-3">Documents</h2>

                {/* Search */}
                <div className="relative mb-4">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                        type="text"
                        placeholder="Search documents..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent text-sm"
                    />
                </div>

                {/* Upload Zone */}
                {!hideUpload && (
                    <div
                        {...getRootProps()}
                        className={`
                p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200
                ${isDragActive
                                ? 'border-[var(--primary)] bg-[var(--primary-glow)]'
                                : 'border-[var(--border)] hover:border-[var(--muted)] hover:bg-[var(--card-hover)]'
                            }
              `}
                        title="Upload PDF Document"
                    >
                        <input {...getInputProps()} />

                        {isUploading ? (
                            <div className="text-center">
                                <Loader2 size={32} className="animate-spin mx-auto mb-2 text-[var(--primary)]" />
                                <p className="text-sm text-[var(--muted)]">Uploading... {uploadProgress}%</p>
                                <div className="w-full h-1.5 bg-[var(--background)] rounded-full mt-2 overflow-hidden">
                                    <motion.div
                                        className="h-full bg-[var(--primary)] rounded-full"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="text-center">
                                <Upload size={32} className="mx-auto mb-2 text-[var(--muted)]" />
                                <p className="text-sm font-medium">
                                    {isDragActive ? 'Drop your PDF here' : 'Drop PDF here or click to upload'}
                                </p>
                                <p className="text-xs text-[var(--muted)] mt-1">
                                    Max 100 pages, 50MB
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Document List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <AnimatePresence>
                    {filteredDocuments.length === 0 ? (
                        <div className="text-center py-12 text-[var(--muted)]">
                            <FileText size={48} className="mx-auto mb-3 opacity-50" />
                            <p className="text-sm">
                                {searchQuery ? 'No documents match your search' : 'No documents yet'}
                            </p>
                        </div>
                    ) : (
                        filteredDocuments.map((doc) => (
                            <motion.div
                                key={doc.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                onClick={() => doc.status === 'ready' && onDocumentSelect(doc)}
                                className={`
                  group p-3 rounded-xl border border-[var(--border)] transition-all duration-200
                  ${doc.status === 'ready'
                                        ? 'cursor-pointer hover:bg-[var(--card-hover)] hover:border-[var(--primary)]'
                                        : 'opacity-70'
                                    }
                `}
                                title={doc.status === 'ready' ? "Open Document" : "Processing..."}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-[var(--primary-glow)] flex items-center justify-center flex-shrink-0">
                                        <FileText size={20} className="text-[var(--primary)]" />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-medium text-sm truncate">
                                            {doc.original_filename}
                                        </h3>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
                                            <span className="flex items-center gap-1">
                                                {getStatusIcon(doc.status)}
                                                {getStatusText(doc.status)}
                                            </span>
                                            {doc.page_count && (
                                                <span>{doc.page_count} pages</span>
                                            )}
                                            <span>{formatFileSize(doc.file_size)}</span>
                                        </div>
                                        <div className="flex items-center gap-1 mt-1 text-xs text-[var(--muted)]">
                                            <Clock size={12} />
                                            {formatDate(doc.created_at)}
                                        </div>
                                    </div>

                                    <button
                                        onClick={(e) => handleDeleteClick(doc.id, e)}
                                        className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[var(--error)]/10 text-[var(--muted)] hover:text-[var(--error)] transition-all"
                                        title="Delete Document"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>

                {/* Delete Confirmation Modal - Portaled to body to cover everything */}
                {deleteConfirmId !== null && createPortal(
                    <AnimatePresence>
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="p-6 text-center">
                                    <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500 ring-4 ring-red-50/50">
                                        <Trash2 size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 mb-2">Delete Document?</h3>
                                    <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                                        Are you sure you want to delete this document? This action cannot be undone.
                                    </p>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={cancelDelete}
                                            className="flex-1 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={confirmDelete}
                                            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors shadow-sm"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    </AnimatePresence>,
                    document.body
                )}
                {/* Duplicate Resolution Modal */}
                {pendingFile !== null && createPortal(
                    <AnimatePresence>
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-100"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="p-6 text-center">
                                    <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4 text-amber-500 ring-4 ring-amber-50/50">
                                        <FileText size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 mb-2">Duplicate File</h3>
                                    <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                                        You already have a document named <span className="font-semibold text-slate-700">"{pendingFile.name}"</span>.
                                        What would you like to do?
                                    </p>
                                    <div className="flex flex-col gap-3">
                                        <button
                                            onClick={handleReplace}
                                            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-sm"
                                        >
                                            Replace Existing
                                        </button>
                                        <button
                                            onClick={handleKeepBoth}
                                            className="w-full px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg transition-colors"
                                        >
                                            Keep Both
                                        </button>
                                        <button
                                            onClick={cancelUpload}
                                            className="w-full px-4 py-2 text-slate-400 hover:text-slate-600 font-medium text-sm transition-colors mt-1"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    </AnimatePresence>,
                    document.body
                )}
            </div>
        </div>
    );
}

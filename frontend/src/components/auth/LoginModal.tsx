'use client';
import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Loader2, AlertCircle, Mail, Lock, Zap, X } from 'lucide-react';
import { authApi, documentApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useAppStore } from '@/store';

export default function LoginModal() {
    const { isLoginModalOpen, setLoginModalOpen, guestDocIds, clearGuestDocIds, setDocuments } = useAppStore();
    const { setAuth } = useAuthStore();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    if (!isLoginModalOpen) return null;

    const onClose = () => setLoginModalOpen(false);

    const handleSuccess = async () => {
        if (guestDocIds.length > 0) {
            try {
                await documentApi.claim(guestDocIds);
                clearGuestDocIds();
                // Reload documents to see claimed ones (and correct owner)
                const res = await documentApi.list(); // no guest IDs needed now
                setDocuments(res.documents);
            } catch (e) {
                console.error('Claim failed', e);
            }
        }
        onClose();
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const formData = new FormData();
            formData.append('username', email);
            formData.append('password', password);

            const { access_token } = await authApi.login(formData);

            useAuthStore.getState().setAuth({ id: 0, email, name: '', role: '', workspace_id: 0 }, access_token);

            const user = await authApi.getMe();
            setAuth(user, access_token);

            await handleSuccess();
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Login failed');
            useAuthStore.getState().logout();
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleSuccess = async (credentialResponse: any) => {
        setIsLoading(true);
        setError('');
        try {
            const { access_token } = await authApi.googleLogin(credentialResponse.credential);

            useAuthStore.getState().setAuth({ id: 0, email: '', name: '', role: '', workspace_id: 0 }, access_token);

            const user = await authApi.getMe();
            setAuth(user, access_token);

            await handleSuccess();
        } catch (err: any) {
            console.error(err);
            setError('Google login failed');
            useAuthStore.getState().logout();
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 border border-slate-100 relative animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="text-center mb-6">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3 text-white shadow-lg shadow-blue-500/20">
                        <span className="font-bold text-xl tracking-tight">D</span>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900">Sign in to continue</h2>
                    <p className="text-slate-500 text-sm mt-1">Save your work and access Documind.ai features</p>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <div className="flex justify-center">
                        <GoogleLogin
                            onSuccess={handleGoogleSuccess}
                            onError={() => setError('Google Login Failed')}
                            useOneTap
                            theme="filled_blue"
                            shape="pill"
                            width="350"
                        />
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-slate-200" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-slate-500">Or email</span>
                        </div>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                placeholder="Email address"
                            />
                        </div>

                        <div>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                placeholder="Password"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 disabled:opacity-70"
                        >
                            {isLoading ? <Loader2 size={18} className="animate-spin" /> : 'Sign In'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GoogleLogin } from '@react-oauth/google';
import { Loader2, AlertCircle, Mail, Lock, Zap } from 'lucide-react';
import { authApi, documentApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useAppStore } from '@/store';

export default function LoginPage() {
    const router = useRouter();
    const setAuth = useAuthStore((state) => state.setAuth);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

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

            // Claim any anonymous documents
            const { guestDocIds, clearGuestDocIds } = useAppStore.getState();
            if (guestDocIds.length > 0) {
                try {
                    await documentApi.claim(guestDocIds);
                    clearGuestDocIds();
                } catch (e) {
                    console.error('Failed to claim documents:', e);
                }
            }

            router.push('/');
        } catch (err: any) {
            const detail = err.response?.data?.detail;
            // Handle various error formats from FastAPI
            let errorMessage = 'Login failed';
            if (typeof detail === 'string') {
                errorMessage = detail;
            } else if (Array.isArray(detail)) {
                errorMessage = detail.map((d: any) => d.msg || d).join(', ');
            } else if (detail?.msg) {
                errorMessage = detail.msg;
            }
            setError(errorMessage);
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

            // Claim any anonymous documents
            const { guestDocIds, clearGuestDocIds } = useAppStore.getState();
            if (guestDocIds.length > 0) {
                try {
                    await documentApi.claim(guestDocIds);
                    clearGuestDocIds();
                } catch (e) {
                    console.error('Failed to claim documents:', e);
                }
            }

            router.push('/');
        } catch (err: any) {
            console.error(err);
            setError('Google login failed');
            useAuthStore.getState().logout();
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
                <div className="text-center mb-8">
                    <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4 text-white shadow-lg shadow-blue-500/20">
                        <span className="font-bold text-2xl tracking-tight">D</span>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">Welcome Back</h1>
                    <p className="text-slate-500 mt-2">Sign in to continue to Documind.ai</p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                        <AlertCircle size={18} />
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <div className="flex justify-center w-full">
                        <div className="w-full">
                            <GoogleLogin
                                onSuccess={handleGoogleSuccess}
                                onError={() => setError('Google Login Failed')}
                                useOneTap
                                theme="filled_blue"
                                shape="pill"
                                width="380"
                            />
                        </div>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-slate-200" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-slate-500">Or continue with email</span>
                        </div>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email Address</label>
                            <div className="relative">
                                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                    placeholder="name@company.com"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isLoading ? <Loader2 size={20} className="animate-spin" /> : 'Sign In'}
                        </button>
                    </form>
                </div>

                <p className="mt-8 text-center text-sm text-slate-500">
                    Don't have an account?{' '}
                    <Link href="/signup" className="text-blue-600 font-medium hover:underline">
                        Create account
                    </Link>
                </p>
            </div>
        </div>
    );
}

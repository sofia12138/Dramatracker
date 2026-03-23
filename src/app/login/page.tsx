'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (user) {
      const redirect = searchParams.get('redirect') || '/';
      router.replace(redirect);
    }
  }, [user, router, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const result = await login(username, password);
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
    } else {
      const redirect = searchParams.get('redirect') || '/';
      router.replace(redirect);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-primary-text-secondary mb-1.5">账号</label>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="请输入账号"
          autoFocus
          required
          className="w-full px-4 py-3 border border-primary-border rounded-xl bg-white text-sm text-primary-text placeholder:text-primary-text-muted focus:outline-none focus:border-primary-accent focus:ring-2 focus:ring-primary-accent/20 transition-all"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-primary-text-secondary mb-1.5">密码</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="请输入密码"
          required
          className="w-full px-4 py-3 border border-primary-border rounded-xl bg-white text-sm text-primary-text placeholder:text-primary-text-muted focus:outline-none focus:border-primary-accent focus:ring-2 focus:ring-primary-accent/20 transition-all"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 bg-primary-accent text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            登录中...
          </>
        ) : (
          '登录'
        )}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-primary-bg">
      <div className="w-full max-w-md">
        <div className="bg-primary-card rounded-2xl shadow-card border border-primary-border p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary-accent flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6m6 0h6m-6 0V9a2 2 0 012-2h2a2 2 0 012 2v10m6 0v-4a2 2 0 00-2-2h-2a2 2 0 00-2 2v4" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-primary-text">DramaTracker</h1>
            <p className="text-sm text-primary-text-muted mt-1">海外短剧榜单监控系统</p>
          </div>

          <Suspense fallback={
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent" />
            </div>
          }>
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-center text-xs text-primary-text-muted mt-6">
          DramaTracker &copy; 2024
        </p>
      </div>
    </div>
  );
}

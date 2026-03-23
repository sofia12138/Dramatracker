'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from './Sidebar';
import { useEffect } from 'react';

const NAV_PERMS: Record<string, string[]> = {
  '/': ['view_dashboard'],
  '/ranking': ['view_ranking'],
  '/review': ['review_drama'],
  '/play-count': ['manage_play_count'],
  '/data-manage': ['manage_data'],
  '/users': ['manage_users'],
  '/settings': ['manage_settings'],
};

function getRequiredPerms(pathname: string): string[] | null {
  for (const [path, perms] of Object.entries(NAV_PERMS)) {
    if (path === '/') {
      if (pathname === '/') return perms;
    } else if (pathname.startsWith(path)) {
      return perms;
    }
  }
  return null;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, hasPermission } = useAuth();

  const isLoginPage = pathname === '/login';
  const isForbiddenPage = pathname === '/forbidden';

  useEffect(() => {
    if (loading || isLoginPage || isForbiddenPage) return;
    if (!user) return;

    const required = getRequiredPerms(pathname);
    if (required && !required.some(p => hasPermission(p))) {
      router.replace('/forbidden');
    }
  }, [pathname, user, loading, hasPermission, router, isLoginPage, isForbiddenPage]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-primary-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-accent" />
          <span className="text-sm text-primary-text-muted">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 bg-primary-bg">
        {children}
      </main>
    </div>
  );
}

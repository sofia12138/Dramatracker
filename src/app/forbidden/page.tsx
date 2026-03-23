'use client';

import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="text-8xl font-bold text-primary-accent/20 mb-4">403</div>
        <h1 className="text-2xl font-bold text-primary-text mb-2">没有访问权限</h1>
        <p className="text-primary-text-muted mb-8">您没有权限访问此页面，请联系管理员。</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回首页
        </Link>
      </div>
    </div>
  );
}

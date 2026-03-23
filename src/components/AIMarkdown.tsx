'use client';

import React from 'react';

interface AIMarkdownProps {
  content: string;
  className?: string;
}

export default function AIMarkdown({ content, className = '' }: AIMarkdownProps) {
  const html = parseMarkdown(content);
  return (
    <div
      className={`ai-markdown prose prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function parseMarkdown(md: string): string {
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-primary-text mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-primary-text mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-primary-text mt-6 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-primary-text">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm text-primary-text-secondary leading-relaxed">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm text-primary-text-secondary leading-relaxed">$2</li>')
    .replace(/\n\n/g, '<br/><br/>');

  html = html
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => {
      if (match.includes('list-disc')) return `<ul class="space-y-1 my-2">${match}</ul>`;
      return `<ol class="space-y-1 my-2">${match}</ol>`;
    });

  return html;
}

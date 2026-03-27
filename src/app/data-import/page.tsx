'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/fetch';

interface DbInfo {
  exists: boolean;
  size: number;
  sizeFormatted: string;
  modifiedAt: string;
}

interface BackupEntry {
  name: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
}

interface ImportResult {
  success: boolean;
  message: string;
  backup: string;
  importedCounts: Record<string, number>;
  newCounts: Record<string, number>;
}

export default function DataImportPage() {
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchInfo = useCallback(() => {
    setLoading(true);
    apiFetch('/api/data/import')
      .then(r => r.json())
      .then(data => {
        setDbInfo(data.dbInfo);
        setCounts(data.counts || {});
        setBackups(data.backups || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setResult(null);
    setError('');
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.db')) {
      setError('仅支持 .db 格式文件');
      return;
    }

    if (selectedFile.size > 100 * 1024 * 1024) {
      setError('文件过大，最大允许 100 MB');
      return;
    }

    const confirmed = window.confirm(
      `确定要用 "${selectedFile.name}" (${formatBytes(selectedFile.size)}) 替换当前线上数据库吗？\n\n` +
      '⚠️ 此操作将替换线上全部数据，旧数据库会自动备份。'
    );
    if (!confirmed) return;

    setUploading(true);
    setResult(null);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await apiFetch('/api/data/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '导入失败');
      } else {
        setResult(data);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchInfo();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadBackup = () => {
    window.open('/api/data/backup', '_blank');
  };

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-primary-text">数据库导入</h1>
          <p className="mt-1 text-sm text-primary-text-muted">
            上传本地抓取好的 SQLite 数据库文件，替换线上数据。旧数据库会自动备份。
          </p>
        </div>

        {/* Current DB Info */}
        <div className="bg-primary-card border border-primary-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-primary-text mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
            当前数据库
          </h2>

          {loading ? (
            <div className="text-primary-text-muted text-sm">加载中...</div>
          ) : dbInfo?.exists ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <InfoCard label="文件大小" value={dbInfo.sizeFormatted} />
              <InfoCard label="最后修改" value={formatDate(dbInfo.modifiedAt)} />
              <InfoCard label="剧集数量" value={String(counts.drama || 0)} />
              <InfoCard label="榜单快照" value={String(counts.ranking_snapshot || 0)} />
            </div>
          ) : (
            <div className="text-yellow-600 text-sm">数据库文件不存在</div>
          )}

          <div className="mt-4">
            <button
              onClick={handleDownloadBackup}
              disabled={!dbInfo?.exists}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-primary-border text-primary-text hover:bg-primary-sidebar transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              下载当前数据库备份
            </button>
          </div>
        </div>

        {/* Upload Section */}
        <div className="bg-primary-card border border-primary-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-primary-text mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            上传新数据库
          </h2>

          <div className="space-y-4">
            {/* Instructions */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <p className="font-medium mb-2">导入说明：</p>
              <ul className="list-disc list-inside space-y-1 text-blue-700">
                <li>仅支持 <code className="bg-blue-100 px-1 rounded">.db</code> 格式的 SQLite 文件</li>
                <li>文件大小限制：100 MB</li>
                <li>上传的数据库必须包含 <code className="bg-blue-100 px-1 rounded">drama</code> 和 <code className="bg-blue-100 px-1 rounded">ranking_snapshot</code> 表</li>
                <li>导入前会自动备份当前数据库</li>
                <li>导入后数据库连接会自动重建，无需重启服务</li>
              </ul>
            </div>

            {/* File Input */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <label className="flex-1 w-full">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".db"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-primary-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-accent file:text-white hover:file:bg-primary-accent/90 file:cursor-pointer file:transition-colors"
                />
              </label>
              <button
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-primary-accent text-white hover:bg-primary-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {uploading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    导入中...
                  </>
                ) : (
                  '开始导入'
                )}
              </button>
            </div>

            {/* Selected File Preview */}
            {selectedFile && (
              <div className="flex items-center gap-3 p-3 bg-primary-sidebar rounded-lg border border-primary-border">
                <svg className="w-5 h-5 text-primary-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary-text truncate">{selectedFile.name}</p>
                  <p className="text-xs text-primary-text-muted">{formatBytes(selectedFile.size)}</p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700 flex items-center gap-2">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </p>
              </div>
            )}

            {/* Success Result */}
            {result && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-3">
                <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {result.message}
                </p>
                {result.backup && (
                  <p className="text-xs text-green-700">备份文件：{result.backup}</p>
                )}
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <p className="text-xs font-medium text-green-800 mb-1">导入数据概览</p>
                    {Object.entries(result.importedCounts).map(([table, count]) => (
                      <p key={table} className="text-xs text-green-700">{table}: {count} 条</p>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-green-800 mb-1">当前数据库</p>
                    {Object.entries(result.newCounts).map(([table, count]) => (
                      <p key={table} className="text-xs text-green-700">{table}: {count} 条</p>
                    ))}
                  </div>
                </div>
                <div className="pt-2 border-t border-green-200">
                  <p className="text-xs text-green-600">
                    数据库连接已自动重建。如发现数据异常，可在下方备份列表中找到旧数据。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Backup History */}
        <div className="bg-primary-card border border-primary-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-primary-text mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            备份历史（最近 10 条）
          </h2>

          {backups.length === 0 ? (
            <p className="text-sm text-primary-text-muted">暂无备份记录</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-primary-border">
                    <th className="text-left py-2 px-3 text-primary-text-muted font-medium">文件名</th>
                    <th className="text-left py-2 px-3 text-primary-text-muted font-medium">大小</th>
                    <th className="text-left py-2 px-3 text-primary-text-muted font-medium">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.name} className="border-b border-primary-border/50 hover:bg-primary-sidebar/50">
                      <td className="py-2 px-3 text-primary-text font-mono text-xs">{b.name}</td>
                      <td className="py-2 px-3 text-primary-text-secondary">{b.sizeFormatted}</td>
                      <td className="py-2 px-3 text-primary-text-secondary">{formatDate(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Warning */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm text-yellow-800 flex items-start gap-2">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span>
              <strong>注意：</strong>如果导入后数据库连接出现异常（极少情况），
              可以在服务器上执行 <code className="bg-yellow-100 px-1 rounded">pm2 restart dramatracker</code> 手动重启服务。
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-primary-sidebar rounded-lg p-3 border border-primary-border/50">
      <p className="text-xs text-primary-text-muted mb-1">{label}</p>
      <p className="text-sm font-semibold text-primary-text">{value}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

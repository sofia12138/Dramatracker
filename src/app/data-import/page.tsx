'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/fetch';

type ImportMode = 'merge' | 'replace';

interface BackupEntry {
  name: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
}

interface ValidationSnapshot {
  drama: number;
  ranking_snapshot: number;
  invest_trend: number | null;
  hasInvestTrendTable: boolean;
}

interface ImportResult {
  success: boolean;
  verified?: boolean;
  rolledBack?: boolean;
  mode: ImportMode;
  message: string;
  stats?: { drama_new: number; drama_updated: number; drama_skipped: number; ranking_inserted: number; trend_inserted: number };
  newCounts?: Record<string, number>;
  backup?: string | null;
  dbPath?: string;
  backupPath?: string | null;
  uploadedFileSize?: number;
  uploadedWalSize?: number;
  oldFileSize?: number;
  newFileSize?: number;
  validationBeforeReplace?: ValidationSnapshot;
}

export default function DataImportPage() {
  const [mode, setMode] = useState<ImportMode>('merge');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedWalFile, setSelectedWalFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const walInputRef = useRef<HTMLInputElement>(null);

  const fetchInfo = useCallback(() => {
    setLoading(true);
    apiFetch('/api/data/import')
      .then(r => r.json())
      .then(data => {
        setCounts(data.counts || {});
        setBackups(data.backups || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const resetForm = () => {
    setSelectedFile(null);
    setSelectedWalFile(null);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (walInputRef.current) walInputRef.current.value = '';
  };

  const handleModeChange = (newMode: ImportMode) => {
    setMode(newMode);
    resetForm();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] || null);
    setResult(null);
    setError('');
  };

  const handleWalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedWalFile(e.target.files?.[0] || null);
    setResult(null);
    setError('');
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (mode === 'merge' && !selectedFile.name.endsWith('.db')) {
      setError('仅支持 .db 格式文件');
      return;
    }

    if (selectedFile.size > 100 * 1024 * 1024) {
      setError('文件过大，最大允许 100 MB');
      return;
    }

    const confirmMsg = mode === 'merge'
      ? `确定要从 "${selectedFile.name}" (${formatBytes(selectedFile.size)}) 导入抓取数据吗？\n\n` +
        '只会合并抓取数据，不会覆盖线上已有的审核结果。'
      : `确定要用 "${selectedFile.name}" (${formatBytes(selectedFile.size)}) 替换线上整个数据库吗？\n\n` +
        '⚠️ 整库替换将覆盖线上所有数据（包括已审核的数据）！\n' +
        '替换前会自动备份当前数据库。\n\n' +
        (selectedWalFile ? `WAL 文件：${selectedWalFile.name} (${formatBytes(selectedWalFile.size)})\n\n` : '') +
        '请确认你了解风险后再继续。';

    if (!window.confirm(confirmMsg)) return;

    setUploading(true);
    setResult(null);
    setError('');

    try {
      const formData = new FormData();
      formData.append('mode', mode);
      formData.append('file', selectedFile);
      if (mode === 'replace' && selectedWalFile) {
        formData.append('walFile', selectedWalFile);
      }

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
        setSelectedWalFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (walInputRef.current) walInputRef.current.value = '';
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
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-primary-text">数据库导入</h1>
            <EnvBadge />
          </div>
          <p className="mt-1 text-sm text-primary-text-muted">
            上传本地 SQLite 数据库到线上，支持增量合并和整库替换两种模式。
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
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <InfoCard label="剧集数量" value={String(counts.drama || 0)} />
              <InfoCard label="榜单快照" value={String(counts.ranking_snapshot || 0)} />
              <InfoCard label="投放趋势" value={String(counts.invest_trend || 0)} />
            </div>
          )}

          <div className="mt-4">
            <button
              onClick={handleDownloadBackup}
              disabled={!counts.drama}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-primary-border text-primary-text hover:bg-primary-sidebar transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              下载当前数据库备份
            </button>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="bg-primary-card border border-primary-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-primary-text mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            上传数据库
          </h2>

          {/* Mode Tabs */}
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => handleModeChange('merge')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                mode === 'merge'
                  ? 'bg-primary-accent text-white'
                  : 'bg-primary-sidebar text-primary-text-secondary hover:bg-primary-card border border-primary-border'
              }`}
            >
              增量合并
            </button>
            <button
              onClick={() => handleModeChange('replace')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                mode === 'replace'
                  ? 'bg-red-500 text-white'
                  : 'bg-primary-sidebar text-primary-text-secondary hover:bg-primary-card border border-primary-border'
              }`}
            >
              整库替换
            </button>
          </div>

          <div className="space-y-4">
            {/* Instructions — Merge */}
            {mode === 'merge' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <p className="font-medium mb-2">增量合并说明：</p>
                <ul className="list-disc list-inside space-y-1 text-blue-700">
                  <li>上传 <code className="bg-blue-100 px-1 rounded">.db</code> 格式的 SQLite 文件（最大 100 MB）</li>
                  <li>新剧集会插入，已有剧集只更新标题、封面等抓取字段</li>
                  <li>线上已有的 <code className="bg-blue-100 px-1 rounded">is_ai_drama</code>、题材标签等审核结果不会被覆盖</li>
                  <li>榜单快照和投放趋势按唯一键去重，不会产生重复数据</li>
                </ul>
              </div>
            )}

            {/* Instructions — Replace */}
            {mode === 'replace' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                <p className="font-medium mb-2">整库替换说明：</p>
                <ul className="list-disc list-inside space-y-1 text-red-700">
                  <li><strong>主库文件</strong>（<code className="bg-red-100 px-1 rounded">dramatracker.db</code>）：必须上传</li>
                  <li><strong>WAL 文件</strong>（<code className="bg-red-100 px-1 rounded">dramatracker.db-wal</code>）：建议一起上传，确保数据完整</li>
                  <li><strong>SHM 文件</strong>（<code className="bg-red-100 px-1 rounded">.db-shm</code>）：不需要上传，系统会自动处理</li>
                  <li>替换前会自动备份当前数据库到 <code className="bg-red-100 px-1 rounded">data/backup/</code></li>
                  <li>如果替换失败，系统会自动回滚到备份</li>
                </ul>
                <p className="mt-3 font-semibold text-red-900">
                  ⚠️ 整库替换会覆盖线上所有数据，包括已审核的记录！请确认你了解风险。
                </p>
              </div>
            )}

            {/* File Inputs */}
            <div className="space-y-3">
              {/* Main DB File */}
              <div>
                <label className="block text-sm font-medium text-primary-text mb-1.5">
                  {mode === 'merge' ? '选择数据库文件' : '主库文件（必传）'}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".db"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-primary-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-accent file:text-white hover:file:bg-primary-accent/90 file:cursor-pointer file:transition-colors"
                />
              </div>

              {/* WAL File (replace mode only) */}
              {mode === 'replace' && (
                <div>
                  <label className="block text-sm font-medium text-primary-text mb-1.5">
                    WAL 文件（建议上传）
                  </label>
                  <input
                    ref={walInputRef}
                    type="file"
                    onChange={handleWalFileSelect}
                    className="block w-full text-sm text-primary-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-500 file:text-white hover:file:bg-orange-600 file:cursor-pointer file:transition-colors"
                  />
                  <p className="mt-1 text-xs text-primary-text-muted">
                    通常位于 data/ 目录下，文件名为 dramatracker.db-wal
                  </p>
                </div>
              )}

              {/* Upload Button */}
              <div className="pt-1">
                <button
                  onClick={handleUpload}
                  disabled={!selectedFile || uploading}
                  className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                    mode === 'replace'
                      ? 'bg-red-500 hover:bg-red-600'
                      : 'bg-primary-accent hover:bg-primary-accent/90'
                  }`}
                >
                  {uploading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      {mode === 'replace' ? '替换中...' : '导入中...'}
                    </>
                  ) : (
                    mode === 'replace' ? '开始替换' : '开始导入'
                  )}
                </button>
              </div>
            </div>

            {/* Selected Files Preview */}
            {(selectedFile || selectedWalFile) && (
              <div className="space-y-2">
                {selectedFile && (
                  <FilePreview label="主库" name={selectedFile.name} size={selectedFile.size} variant="main" />
                )}
                {selectedWalFile && (
                  <FilePreview label="WAL" name={selectedWalFile.name} size={selectedWalFile.size} variant="wal" />
                )}
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

                {/* Merge-specific stats */}
                {result.mode === 'merge' && result.stats && result.newCounts && (
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div>
                      <p className="text-xs font-medium text-green-800 mb-1">合并结果</p>
                      <p className="text-xs text-green-700">新增剧集：{result.stats.drama_new} 部</p>
                      <p className="text-xs text-green-700">更新元数据：{result.stats.drama_updated} 部</p>
                      <p className="text-xs text-green-700">新增榜单记录：{result.stats.ranking_inserted} 条</p>
                      {result.stats.trend_inserted > 0 && (
                        <p className="text-xs text-green-700">新增投放趋势：{result.stats.trend_inserted} 条</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-green-800 mb-1">当前数据库</p>
                      {Object.entries(result.newCounts).map(([table, count]) => (
                        <p key={table} className="text-xs text-green-700">{table}: {count} 条</p>
                      ))}
                      {result.dbPath && (
                        <p className="text-xs text-green-600 mt-1 break-all font-mono">{result.dbPath}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Replace-specific stats */}
                {result.mode === 'replace' && result.newCounts && (
                  <div className="mt-2 space-y-2">
                    {result.verified && (
                      <p className="text-xs font-semibold text-green-800">
                        服务端已校验：上传库行数与替换后一致（非仅“表存在”的假成功）。
                      </p>
                    )}
                    <p className="text-xs font-medium text-green-800 mb-1">替换后数据库</p>
                    {Object.entries(result.newCounts).map(([table, count]) => (
                      <p key={table} className="text-xs text-green-700">{table}: {count} 条</p>
                    ))}
                    {result.validationBeforeReplace && (
                      <p className="text-xs text-green-600">
                        上传库校验：drama {result.validationBeforeReplace.drama}，ranking_snapshot {result.validationBeforeReplace.ranking_snapshot}
                        {result.validationBeforeReplace.hasInvestTrendTable ? `，invest_trend ${result.validationBeforeReplace.invest_trend}` : ''}
                      </p>
                    )}
                    {result.dbPath && (
                      <p className="text-xs text-green-700 break-all font-mono">路径：{result.dbPath}</p>
                    )}
                    {(result.oldFileSize !== undefined || result.newFileSize !== undefined) && (
                      <p className="text-xs text-green-600">
                        原主库大小 {formatBytes(result.oldFileSize ?? 0)} → 新主库大小 {formatBytes(result.newFileSize ?? 0)}
                        {result.uploadedFileSize !== undefined ? `（上传 ${formatBytes(result.uploadedFileSize)}）` : ''}
                      </p>
                    )}
                    {(result.backupPath || result.backup) && (
                      <p className="text-xs text-green-600 mt-1 break-all">
                        备份：{result.backupPath ?? result.backup}
                      </p>
                    )}
                  </div>
                )}

                {result.mode === 'merge' && (
                  <div className="pt-2 border-t border-green-200">
                    <p className="text-xs text-green-600">
                      线上审核数据（is_ai_drama、题材标签）均已保留，未被覆盖。
                    </p>
                  </div>
                )}
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

        {/* Bottom Info */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-sm text-emerald-800 flex items-start gap-2">
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>
              <strong>两种模式区别：</strong>
              「增量合并」保护线上审核数据（is_ai_drama、题材标签等），只合并抓取字段；
              「整库替换」会用上传的数据库完全覆盖线上数据库，替换前自动备份。
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function FilePreview({ label, name, size, variant }: { label: string; name: string; size: number; variant: 'main' | 'wal' }) {
  const badgeCls = variant === 'wal'
    ? 'bg-orange-100 text-orange-600'
    : 'bg-blue-100 text-blue-600';
  return (
    <div className="flex items-center gap-3 p-3 bg-primary-sidebar rounded-lg border border-primary-border">
      <span className={`text-xs font-medium px-2 py-0.5 rounded ${badgeCls}`}>{label}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-primary-text truncate">{name}</p>
        <p className="text-xs text-primary-text-muted">{formatBytes(size)}</p>
      </div>
    </div>
  );
}

function EnvBadge() {
  const [env, setEnv] = useState('');
  useEffect(() => {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      setEnv('本地开发');
    } else {
      setEnv('线上环境');
    }
  }, []);
  if (!env) return null;
  const isLocal = env === '本地开发';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
      isLocal ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-700'
    }`}>
      {env}
    </span>
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

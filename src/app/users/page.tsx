'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/fetch';

interface User {
  id: number;
  username: string;
  name: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_login_at: string;
}

const ROLES = [
  { value: 'super_admin', label: '超级管理员' },
  { value: 'operation', label: '运营' },
  { value: 'placement', label: '投放' },
  { value: 'production', label: '制作' },
  { value: 'screenwriter', label: '编剧' },
];

const ROLE_PERMS: Record<string, string[]> = {
  super_admin: ['全部权限'],
  operation: ['查看榜单', '审核标记', '导出数据', '播放量管理'],
  placement: ['查看榜单', '审核标记', '导出数据', '播放量管理'],
  production: ['查看榜单'],
  screenwriter: ['查看榜单'],
};

interface Toast {
  id: number;
  message: string;
  type: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    role: 'operation',
    is_active: 1,
  });

  const showToast = useCallback((message: string, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  const fetchUsers = useCallback(() => {
    setLoading(true);
    apiFetch('/api/users')
      .then(r => {
        if (r.status === 403) throw new Error('无权限');
        return r.json();
      })
      .then(data => { setUsers(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const res = await apiFetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) { showToast('更新失败', 'error'); return; }
        showToast('用户已更新');
      } else {
        const res = await apiFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) { showToast('创建失败', 'error'); return; }
        showToast('用户已创建');
      }
      setShowForm(false);
      setEditingUser(null);
      setForm({ username: '', password: '', name: '', role: 'operation', is_active: 1 });
      fetchUsers();
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      username: user.username,
      password: '',
      name: user.name || '',
      role: user.role,
      is_active: user.is_active,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此用户吗？')) return;
    const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('用户已删除'); fetchUsers(); }
    else showToast('删除失败', 'error');
  };

  const handleToggleActive = async (user: User) => {
    const newStatus = user.is_active ? 0 : 1;
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...user, is_active: newStatus }),
    });
    if (res.ok) {
      showToast(newStatus ? '已启用' : '已停用');
      fetchUsers();
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordId || !newPassword) return;
    const res = await apiFetch(`/api/users/${resetPasswordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    if (res.ok) {
      showToast('密码已重置');
      setResetPasswordId(null);
      setNewPassword('');
    } else {
      showToast('重置失败', 'error');
    }
  };

  const getRoleLabel = (role: string) => ROLES.find(r => r.value === role)?.label || role;

  return (
    <div className="space-y-4">
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in flex items-center gap-2 ${
              toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-primary-accent text-white'
            }`}
          >
            {toast.type === 'error' ? (
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            ) : (
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            )}
            {toast.message}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-text">用户管理</h1>
        <button
          onClick={() => { setShowForm(!showForm); setEditingUser(null); setForm({ username: '', password: '', name: '', role: 'operation', is_active: 1 }); }}
          className="px-4 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {showForm ? '取消' : '+ 新增用户'}
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h2 className="text-lg font-semibold text-primary-text mb-4">{editingUser ? '编辑用户' : '新增用户'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">用户名 *</label>
              <input type="text" required value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                disabled={!!editingUser}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent disabled:bg-primary-sidebar disabled:text-primary-text-muted" />
            </div>
            {!editingUser && (
              <div>
                <label className="block text-sm text-primary-text-secondary mb-1">密码 *</label>
                <input type="password" required value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
              </div>
            )}
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">姓名 *</label>
              <input type="text" required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">角色 *</label>
              <select value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent">
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <p className="text-xs text-primary-text-muted mt-1">
                权限：{(ROLE_PERMS[form.role] || []).join('、')}
              </p>
            </div>
            <div className="md:col-span-2">
              <button type="submit"
                className="px-6 py-2 bg-primary-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                {editingUser ? '更新' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reset Password Dialog */}
      {resetPasswordId && (
        <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center" onClick={() => setResetPasswordId(null)}>
          <div className="bg-primary-card rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-primary-text mb-4">重置密码</h3>
            <p className="text-sm text-primary-text-secondary mb-3">
              为用户 <strong>{users.find(u => u.id === resetPasswordId)?.username}</strong> 设置新密码
            </p>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="输入新密码"
              className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setResetPasswordId(null); setNewPassword(''); }}
                className="px-4 py-2 text-sm text-primary-text-secondary border border-primary-border rounded-lg hover:bg-primary-card"
              >
                取消
              </button>
              <button
                onClick={handleResetPassword}
                disabled={!newPassword}
                className="px-4 py-2 text-sm bg-primary-accent text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-accent"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary-border">
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">姓名</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">用户名</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">角色</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">状态</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">最后登录</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-b border-primary-border/50 hover:bg-primary-accent-bg/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary-accent/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-medium text-primary-accent">{(user.name || user.username).charAt(0)}</span>
                        </div>
                        <span className="text-primary-text font-medium">{user.name || '-'}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-primary-text-secondary">{user.username}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-primary-accent-bg text-primary-accent text-xs rounded-full border border-primary-accent-border">
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleToggleActive(user)}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
                        style={{ backgroundColor: user.is_active ? '#3b5bdb' : '#d0d5e0' }}
                      >
                        <span
                          className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
                          style={{ transform: user.is_active ? 'translateX(18px)' : 'translateX(3px)' }}
                        />
                      </button>
                    </td>
                    <td className="py-3 px-4 text-primary-text-muted text-xs">{user.last_login_at || '从未登录'}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEdit(user)}
                          className="text-primary-accent hover:underline text-xs">编辑</button>
                        <button onClick={() => { setResetPasswordId(user.id); setNewPassword(''); }}
                          className="text-amber-600 hover:underline text-xs">重置密码</button>
                        {user.role !== 'super_admin' && (
                          <button onClick={() => handleDelete(user.id)}
                            className="text-red-500 hover:underline text-xs">删除</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

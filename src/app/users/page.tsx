'use client';

import { useEffect, useState, useCallback } from 'react';

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

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    role: 'operation',
    is_active: 1,
  });

  const fetchUsers = useCallback(() => {
    setLoading(true);
    fetch('/api/users')
      .then(r => r.json())
      .then(data => { setUsers(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await fetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      } else {
        await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      setEditingUser(null);
      setForm({ username: '', password: '', name: '', role: 'operation', is_active: 1 });
      fetchUsers();
    } catch (error) {
      console.error('Submit failed:', error);
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
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    fetchUsers();
  };

  const getRoleLabel = (role: string) => ROLES.find(r => r.value === role)?.label || role;

  return (
    <div className="space-y-4">
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
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">
                密码 {editingUser ? '(留空则不修改)' : '*'}
              </label>
              <input type="password" required={!editingUser} value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2 border border-primary-border rounded-lg bg-white text-sm focus:outline-none focus:border-primary-accent" />
            </div>
            <div>
              <label className="block text-sm text-primary-text-secondary mb-1">姓名</label>
              <input type="text" value={form.name}
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
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active === 1}
                  onChange={e => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })}
                  className="w-4 h-4 text-primary-accent rounded" />
                <span className="text-sm text-primary-text-secondary">启用账号</span>
              </label>
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
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">ID</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">用户名</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">姓名</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">角色</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">状态</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">创建时间</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">最后登录</th>
                  <th className="text-left py-3 px-4 font-medium text-primary-text-secondary">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-b border-primary-border/50 hover:bg-primary-accent-bg/30 transition-colors">
                    <td className="py-3 px-4 text-primary-text-muted">{user.id}</td>
                    <td className="py-3 px-4 text-primary-text font-medium">{user.username}</td>
                    <td className="py-3 px-4 text-primary-text-secondary">{user.name || '-'}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-primary-accent-bg text-primary-accent text-xs rounded-full border border-primary-accent-border">
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 text-xs ${user.is_active ? 'text-green-600' : 'text-red-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.is_active ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        {user.is_active ? '启用' : '禁用'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-primary-text-muted text-xs">{user.created_at}</td>
                    <td className="py-3 px-4 text-primary-text-muted text-xs">{user.last_login_at || '-'}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEdit(user)}
                          className="text-primary-accent hover:underline text-xs">编辑</button>
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

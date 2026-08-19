import { useEffect, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { User } from '../../types'
import { IconBtn, PanelTable, Tag } from './ProductsPage'

interface ResetPasswordRes {
  password: string
  message: string
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function UsersPage() {
  const { showToast } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null)

  async function load() {
    setUsers(await api.get<User[]>('/api/users'))
  }

  useEffect(() => {
    load().catch((e) => {
      setUsers([])
      showToast(e instanceof ApiError ? e.message : '用户列表加载失败')
    })
  }, [])

  async function resetPassword(u: User) {
    if (!window.confirm(`确定重置「${u.username}」的密码？重置后该账号的登录状态会失效。`)) return
    try {
      const res = await api.post<ResetPasswordRes>(`/api/users/${u.username}/reset-password`)
      setIssued({ username: u.username, password: res.password })
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '重置失败')
    }
  }

  async function toggle(u: User) {
    try {
      await api.post(`/api/users/${u.username}/toggle`)
      await load()
      showToast(u.disabled ? '已启用' : '已禁用')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '操作失败')
    }
  }

  return (
    <>
    {issued && (
      <div className="mb-4 rounded-[14px] border border-[var(--line-strong)] bg-[rgba(196,165,116,.14)] px-4 py-3.5">
        <div className="text-[0.88rem] font-semibold">已为「{issued.username}」生成新密码</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 font-[family-name:var(--font-mono)] text-[0.92rem]">
            {issued.password}
          </code>
          <button
            type="button"
            className="h-9 rounded-[10px] border border-[var(--line-strong)] bg-white px-3 text-[0.82rem] font-semibold text-teal"
            onClick={() => {
              navigator.clipboard?.writeText(issued.password)
              showToast('密码已复制')
            }}
          >
            复制
          </button>
          <button
            type="button"
            className="h-9 rounded-[10px] px-3 text-[0.82rem] font-semibold text-ink-mute hover:text-ink"
            onClick={() => setIssued(null)}
          >
            我已记录
          </button>
        </div>
        <p className="mt-2 text-[0.8rem] text-ink-mute">仅本次显示，请转达用户并提醒其尽快修改。</p>
      </div>
    )}
    <PanelTable headers={['用户名', '邮箱', '角色', '注册时间', '状态', '操作']} empty={!users.length}>
      {users.map((u) => (
        <tr key={u.id} className="border-t border-[var(--line)] hover:bg-[rgba(232,241,238,.4)]">
          <td className="whitespace-nowrap px-[18px] py-3.5">{u.username}</td>
          <td className="max-w-[180px] truncate px-[18px] py-3.5 text-[0.85rem] text-ink-soft">{u.email || '—'}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            {u.role === 'admin' ? <Tag gold>管理员</Tag> : '用户'}
          </td>
          <td className="whitespace-nowrap px-[18px] py-3.5">{fmtTime(u.created_at)}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            <Tag green={!u.disabled} red={u.disabled}>{u.disabled ? '已禁用' : '正常'}</Tag>
          </td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            <div className="flex gap-2">
              <IconBtn title="重置密码" onClick={() => resetPassword(u)}>
                ↻
              </IconBtn>
              {u.role !== 'admin' && (
                <IconBtn title={u.disabled ? '启用' : '禁用'} danger={!u.disabled} onClick={() => toggle(u)}>
                  {u.disabled ? '✓' : '–'}
                </IconBtn>
              )}
            </div>
          </td>
        </tr>
      ))}
    </PanelTable>
    </>
  )
}

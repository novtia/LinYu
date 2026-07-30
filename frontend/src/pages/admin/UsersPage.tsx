import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { User } from '../../types'
import { IconBtn, PanelTable, Tag } from './ProductsPage'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function UsersPage() {
  const { showToast } = useToast()
  const [users, setUsers] = useState<User[]>([])

  async function load() {
    setUsers(await api.get<User[]>('/api/users'))
  }

  useEffect(() => {
    load().catch(() => setUsers([]))
  }, [])

  return (
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
              <IconBtn
                title="重置密码"
                onClick={async () => {
                  await api.post(`/api/users/${u.username}/reset-password`)
                  showToast('已重置为 123456')
                }}
              >
                ↻
              </IconBtn>
              {u.role !== 'admin' && (
                <IconBtn
                  title={u.disabled ? '启用' : '禁用'}
                  danger={!u.disabled}
                  onClick={async () => {
                    await api.post(`/api/users/${u.username}/toggle`)
                    await load()
                    showToast(u.disabled ? '已启用' : '已禁用')
                  }}
                >
                  {u.disabled ? '✓' : '–'}
                </IconBtn>
              )}
            </div>
          </td>
        </tr>
      ))}
    </PanelTable>
  )
}

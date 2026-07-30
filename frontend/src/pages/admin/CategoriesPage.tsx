import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { Category } from '../../types'
import { IconBtn, PanelTable, Tag } from './ProductsPage'

export function CategoriesPage() {
  const { showToast } = useToast()
  const [categories, setCategories] = useState<Category[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState({ name: '', sort_order: '0', enabled: true })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setCategories(await api.get<Category[]>('/api/categories/admin'))
  }

  useEffect(() => {
    load().catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) closeModal()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, saving])

  function closeModal() {
    setOpen(false)
    setEditing(null)
    setError('')
    setForm({ name: '', sort_order: '0', enabled: true })
  }

  function startCreate() {
    setEditing(null)
    setForm({
      name: '',
      sort_order: String((categories[categories.length - 1]?.sort_order ?? -1) + 1),
      enabled: true,
    })
    setError('')
    setOpen(true)
  }

  function startEdit(c: Category) {
    setEditing(c)
    setForm({ name: c.name, sort_order: String(c.sort_order), enabled: c.enabled })
    setError('')
    setOpen(true)
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    const sort_order = Number(form.sort_order)
    if (!name) {
      setError('请填写分类名称')
      return
    }
    if (Number.isNaN(sort_order)) {
      setError('排序需为数字')
      return
    }
    setSaving(true)
    setError('')
    try {
      const body = { name, sort_order, enabled: form.enabled }
      if (editing) {
        await api.put(`/api/categories/${editing.id}`, body)
        showToast('分类已更新')
      } else {
        await api.post('/api/categories', body)
        showToast('分类已创建')
      }
      closeModal()
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(c: Category) {
    if (!confirm(`确定删除分类「${c.name}」？`)) return
    try {
      await api.delete(`/api/categories/${c.id}`)
      showToast('已删除')
      if (editing?.id === c.id) closeModal()
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex h-9 items-center rounded-[10px] bg-ink px-3.5 text-[0.86rem] font-semibold text-white hover:bg-teal-deep"
        >
          新增分类
        </button>
      </div>

      <PanelTable headers={['ID', '名称', '排序', '状态', '操作']} empty={!categories.length} emptyText="暂无分类，请先新增">
        {categories.map((c) => (
          <tr key={c.id} className="border-t border-[var(--line)] hover:bg-[rgba(232,241,238,.4)]">
            <td className="whitespace-nowrap px-[18px] py-3.5 font-[family-name:var(--font-mono)] text-[0.85rem]">{c.id}</td>
            <td className="whitespace-nowrap px-[18px] py-3.5 font-medium">{c.name}</td>
            <td className="whitespace-nowrap px-[18px] py-3.5">{c.sort_order}</td>
            <td className="whitespace-nowrap px-[18px] py-3.5">
              <Tag green={c.enabled} red={!c.enabled}>
                {c.enabled ? '启用' : '停用'}
              </Tag>
            </td>
            <td className="whitespace-nowrap px-[18px] py-3.5">
              <div className="flex gap-2">
                <IconBtn title="编辑" onClick={() => startEdit(c)}>
                  ✎
                </IconBtn>
                <IconBtn title="删除" danger onClick={() => onDelete(c)}>
                  ✕
                </IconBtn>
              </div>
            </td>
          </tr>
        ))}
      </PanelTable>

      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(20,32,28,.45)] p-4 backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) closeModal()
          }}
        >
          <form
            onSubmit={onSave}
            className="w-full max-w-md overflow-hidden rounded-[18px] border border-[var(--line)] bg-white shadow-[0_24px_60px_-28px_rgba(20,32,28,.55)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-modal-title"
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] px-[18px] py-3.5">
              <h3 id="category-modal-title" className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold">
                {editing ? '编辑分类' : '新增分类'}
              </h3>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-mute hover:bg-paper hover:text-ink"
                onClick={closeModal}
                disabled={saving}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="grid gap-4 p-[18px]">
              <label className="grid gap-1.5">
                <span className="text-[0.82rem] font-semibold text-ink-soft">名称</span>
                <input
                  className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3.5 outline-none focus:border-teal"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：软件授权"
                  autoFocus
                  required
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[0.82rem] font-semibold text-ink-soft">排序</span>
                <input
                  type="number"
                  className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3.5 outline-none focus:border-teal"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3.5 py-3">
                <span className="text-[0.88rem] font-semibold">启用</span>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
              </label>
              {error ? <div className="text-[0.82rem] text-danger">{error}</div> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-paper px-[18px] py-3.5">
              <button
                type="button"
                className="h-9 rounded-[10px] border border-[var(--line-strong)] bg-white px-3.5 text-[0.86rem] font-semibold"
                onClick={closeModal}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

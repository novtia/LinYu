import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartItem, Product, PublicPaymentMethod } from '../types'

const CART_KEY = 'lingxia_cart'

function readStoredCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 已发货内容不落地，避免发货信息留在浏览器
    return parsed
      .filter((it) => it && typeof it.id === 'number' && typeof it.price === 'number' && !it.delivered)
      .map((it) => ({ ...it, delivered: false, payload: '' }))
  } catch {
    return []
  }
}

interface CartContextValue {
  items: CartItem[]
  open: boolean
  openCart: () => void
  closeCart: () => void
  toggleCart: () => void
  addProduct: (p: Product, payment?: PublicPaymentMethod | null, options?: { openDrawer?: boolean }) => void
  removeAt: (index: number) => void
  markDelivered: (payloads: { id: number; payload: string }[]) => void
  clearUndelivered: () => void
  replaceWithDelivered: (items: CartItem[]) => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(readStoredCart)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const persistable = items.filter((it) => !it.delivered)
      if (persistable.length) {
        localStorage.setItem(CART_KEY, JSON.stringify(persistable))
      } else {
        localStorage.removeItem(CART_KEY)
      }
    } catch {
      /* 隐私模式等场景忽略存储失败 */
    }
  }, [items])

  const addProduct = useCallback((p: Product, payment?: PublicPaymentMethod | null, options?: { openDrawer?: boolean }) => {
    setItems((prev) => [
      ...prev,
      {
        id: p.id,
        name: p.name,
        price: p.price,
        delivered: false,
        payload: '',
        payment: payment
          ? {
              id: payment.id,
              method: payment.method,
              label: payment.label,
              channel_id: payment.channel_id,
              channel_name: payment.channel_name,
              provider: payment.provider,
            }
          : null,
      },
    ])
    if (options?.openDrawer !== false) setOpen(true)
  }, [])

  const removeAt = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const markDelivered = useCallback((payloads: { id: number; payload: string }[]) => {
    setItems((prev) => {
      const queue = [...payloads]
      return prev.map((it) => {
        if (it.delivered) return it
        const idx = queue.findIndex((q) => q.id === it.id)
        if (idx < 0) return it
        const [hit] = queue.splice(idx, 1)
        return { ...it, delivered: true, payload: hit.payload }
      })
    })
  }, [])

  const clearUndelivered = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.delivered))
  }, [])

  const replaceWithDelivered = useCallback((next: CartItem[]) => {
    setItems(next)
  }, [])

  const openCart = useCallback(() => setOpen(true), [])
  const closeCart = useCallback(() => setOpen(false), [])
  const toggleCart = useCallback(() => setOpen((v) => !v), [])

  const value = useMemo(
    () => ({
      items,
      open,
      openCart,
      closeCart,
      toggleCart,
      addProduct,
      removeAt,
      markDelivered,
      clearUndelivered,
      replaceWithDelivered,
    }),
    [items, open, openCart, closeCart, toggleCart, addProduct, removeAt, markDelivered, clearUndelivered, replaceWithDelivered],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}

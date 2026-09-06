import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clampCartQty } from '../components/QuantityStepper'
import type { CartItem, Product, PublicPaymentMethod } from '../types'

const CART_KEY = 'lingxia_cart'

function paymentFrom(method?: PublicPaymentMethod | null): CartItem['payment'] {
  if (!method) return null
  return {
    id: method.id,
    method: method.method,
    label: method.label,
    channel_id: method.channel_id,
    channel_name: method.channel_name,
    provider: method.provider,
  }
}

function asCartItem(raw: Record<string, unknown>, delivered: boolean): CartItem | null {
  if (typeof raw.id !== 'number' || typeof raw.price !== 'number') return null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : String(raw.id),
    price: raw.price,
    quantity: clampCartQty(typeof raw.quantity === 'number' ? raw.quantity : 1),
    delivered,
    payload: delivered && typeof raw.payload === 'string' ? raw.payload : '',
    file_name: typeof raw.file_name === 'string' ? raw.file_name : null,
    download_url: typeof raw.download_url === 'string' ? raw.download_url : null,
    payment:
      raw.payment && typeof raw.payment === 'object'
        ? (raw.payment as CartItem['payment'])
        : null,
  }
}

function mergePending(items: CartItem[]): CartItem[] {
  const merged = new Map<number, CartItem>()
  for (const it of items) {
    const prev = merged.get(it.id)
    if (prev) {
      merged.set(it.id, {
        ...prev,
        quantity: clampCartQty(prev.quantity + it.quantity),
        payment: it.payment || prev.payment,
      })
    } else {
      merged.set(it.id, it)
    }
  }
  return [...merged.values()]
}

function readStoredCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 已发货内容不落地，避免发货信息留在浏览器
    const pending = parsed
      .filter((it) => it && typeof it === 'object' && !it.delivered)
      .map((it) => asCartItem(it as Record<string, unknown>, false))
      .filter((it): it is CartItem => Boolean(it))
    return mergePending(pending)
  } catch {
    return []
  }
}

export function cartLineQty(item: CartItem) {
  return clampCartQty(item.quantity)
}

export function cartLineTotal(item: CartItem) {
  return Math.round(item.price * cartLineQty(item) * 100) / 100
}

export function expandCartLines(items: CartItem[]) {
  return items.flatMap((it) =>
    Array.from({ length: cartLineQty(it) }, () => ({
      id: it.id,
      name: it.name,
      price: it.price,
    })),
  )
}

interface CartContextValue {
  items: CartItem[]
  count: number
  open: boolean
  openCart: () => void
  closeCart: () => void
  toggleCart: () => void
  addProduct: (p: Product, payment?: PublicPaymentMethod | null, options?: { openDrawer?: boolean; quantity?: number }) => void
  setQuantity: (index: number, quantity: number) => void
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

  const addProduct = useCallback((p: Product, payment?: PublicPaymentMethod | null, options?: { openDrawer?: boolean; quantity?: number }) => {
    if (p.sale_mode === 'commission') return
    const addQty = clampCartQty(options?.quantity ?? 1)
    const nextPayment = paymentFrom(payment)
    setItems((prev) => {
      const idx = prev.findIndex((it) => !it.delivered && it.id === p.id)
      if (idx >= 0) {
        const next = [...prev]
        const cur = next[idx]
        next[idx] = {
          ...cur,
          name: p.name,
          price: p.price,
          quantity: clampCartQty(cur.quantity + addQty),
          payment: nextPayment || cur.payment,
        }
        return next
      }
      return [
        ...prev,
        {
          id: p.id,
          name: p.name,
          price: p.price,
          quantity: addQty,
          delivered: false,
          payload: '',
          payment: nextPayment,
        },
      ]
    })
    if (options?.openDrawer !== false) setOpen(true)
  }, [])

  const setQuantity = useCallback((index: number, quantity: number) => {
    setItems((prev) => {
      const cur = prev[index]
      if (!cur || cur.delivered) return prev
      const q = Math.floor(Number(quantity) || 0)
      if (q < 1) return prev.filter((_, i) => i !== index)
      const next = [...prev]
      next[index] = { ...cur, quantity: clampCartQty(q) }
      return next
    })
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

  const count = useMemo(() => items.reduce((n, it) => n + cartLineQty(it), 0), [items])

  const value = useMemo(
    () => ({
      items,
      count,
      open,
      openCart,
      closeCart,
      toggleCart,
      addProduct,
      setQuantity,
      removeAt,
      markDelivered,
      clearUndelivered,
      replaceWithDelivered,
    }),
    [items, count, open, openCart, closeCart, toggleCart, addProduct, setQuantity, removeAt, markDelivered, clearUndelivered, replaceWithDelivered],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}

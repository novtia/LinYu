import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { CartItem, Product } from '../types'

interface CartContextValue {
  items: CartItem[]
  open: boolean
  openCart: () => void
  closeCart: () => void
  addProduct: (p: Product) => void
  removeAt: (index: number) => void
  markDelivered: (payloads: { id: string; payload: string }[]) => void
  clearUndelivered: () => void
  replaceWithDelivered: (items: CartItem[]) => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const [open, setOpen] = useState(false)

  const addProduct = useCallback((p: Product) => {
    setItems((prev) => [...prev, { id: p.id, name: p.name, price: p.price, delivered: false, payload: '' }])
    setOpen(true)
  }, [])

  const removeAt = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const markDelivered = useCallback((payloads: { id: string; payload: string }[]) => {
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

  const value = useMemo(
    () => ({
      items,
      open,
      openCart: () => setOpen(true),
      closeCart: () => setOpen(false),
      addProduct,
      removeAt,
      markDelivered,
      clearUndelivered,
      replaceWithDelivered,
    }),
    [items, open, addProduct, removeAt, markDelivered, clearUndelivered, replaceWithDelivered],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}

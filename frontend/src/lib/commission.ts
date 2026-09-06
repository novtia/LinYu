import type { Product } from '../types'

export function isCommissionProduct(p?: Pick<Product, 'sale_mode'> | null) {
  return p?.sale_mode === 'commission'
}

export function splitPrice(price: number): { deposit: number; balance: number } {
  const cents = Math.round(Number(price) * 100)
  if (cents < 2) return { deposit: 0, balance: 0 }
  const deposit = Math.floor(cents / 2)
  return { deposit: deposit / 100, balance: (cents - deposit) / 100 }
}

export function formatYuan(n: number) {
  return `¥${Math.round(n * 100) / 100}`
}

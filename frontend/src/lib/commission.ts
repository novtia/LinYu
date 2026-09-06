import type { Product } from '../types'

export const MIN_WORDS = 1000

export function isCommissionProduct(p?: Pick<Product, 'sale_mode'> | null) {
  return p?.sale_mode === 'commission'
}

export function splitPrice(price: number): { deposit: number; balance: number } {
  const cents = Math.round(Number(price) * 100)
  if (cents < 2) return { deposit: 0, balance: 0 }
  const deposit = Math.floor(cents / 2)
  return { deposit: deposit / 100, balance: (cents - deposit) / 100 }
}

export function commissionTotal(rate: number, words: number) {
  return Math.round((Number(words) / 1000) * Number(rate) * 100) / 100
}

export function formatYuan(n: number) {
  const value = Math.round(Number(n) * 100) / 100
  return Number.isInteger(value) ? `¥${value}` : `¥${value.toFixed(2)}`
}

export function formatPerK(n: number) {
  return `${formatYuan(n)}/k`
}

export function formatWords(n: number) {
  const words = Math.round(Number(n) || 0)
  if (words >= 10000 && words % 10000 === 0) return `${words / 10000} 万字`
  if (words >= 10000) return `${(words / 10000).toFixed(1).replace(/\.0$/, '')} 万字`
  return `${words.toLocaleString('zh-CN')} 字`
}

export function formatFileSize(bytes?: number | null) {
  const n = Number(bytes || 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

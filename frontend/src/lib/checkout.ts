import type { CheckoutResult } from '../types'

/** 处理结账响应：调试模式直接成功，否则跳转支付。 */
export function resolveCheckoutResult(res: CheckoutResult): 'paid' | 'redirect' | 'error' {
  const paid =
    res.order.status === 'completed' ||
    res.order.status === 'paid' ||
    (res.deliveries && res.deliveries.length > 0)
  if (paid) return 'paid'
  if (res.pay_url) return 'redirect'
  return 'error'
}

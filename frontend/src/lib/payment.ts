import { api } from './api'
import type { PublicPaymentMethods } from '../types'

/** 前台公开支付方式 */
export function fetchPublicPaymentMethods() {
  return api.get<PublicPaymentMethods>('/api/payment/methods')
}

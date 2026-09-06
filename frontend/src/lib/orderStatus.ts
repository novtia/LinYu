/** 订单状态展示 */
export function orderStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '待支付'
    case 'deposit_paid':
      return '已付定金，待交稿'
    case 'awaiting_balance':
      return '待付尾款'
    case 'paid':
      return '已支付'
    case 'completed':
      return '已完成'
    case 'failed':
      return '支付失败'
    case 'cancelled':
      return '已取消'
    default:
      return status || '未知'
  }
}

export function orderStatusTone(status: string): 'teal' | 'warn' | 'mute' | 'danger' {
  switch (status) {
    case 'completed':
    case 'paid':
      return 'teal'
    case 'deposit_paid':
    case 'awaiting_balance':
    case 'pending':
      return 'warn'
    case 'failed':
    case 'cancelled':
      return 'danger'
    default:
      return 'mute'
  }
}

export function orderStatusClass(status: string): string {
  const tone = orderStatusTone(status)
  if (tone === 'teal') return 'bg-[rgba(15,110,92,.12)] text-teal'
  if (tone === 'warn') return 'bg-[rgba(196,165,116,.22)] text-[#8a6a2f]'
  if (tone === 'danger') return 'bg-[rgba(180,35,24,.1)] text-danger'
  return 'bg-paper text-ink-mute'
}

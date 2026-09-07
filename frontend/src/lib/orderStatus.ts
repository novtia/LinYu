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

/** 圆点状态色调：定金已付视为进行中（teal） */
export function orderDotTone(status: string): 'teal' | 'warn' | 'danger' | 'mute' {
  if (status === 'deposit_paid' || status === 'paid' || status === 'completed') return 'teal'
  return orderStatusTone(status)
}

/** 圆点 + 文字组合类名（配合内部 <i> 圆点使用） */
export function orderDotClass(status: string): string {
  const tone = orderDotTone(status)
  if (tone === 'teal') return 'text-teal [&_i]:bg-teal'
  if (tone === 'warn') return 'text-[#8a6a2f] [&_i]:bg-[#c4a574]'
  if (tone === 'danger') return 'text-danger [&_i]:bg-danger'
  return 'text-ink-mute [&_i]:bg-[var(--line-strong)]'
}

/** 列表里的紧凑状态文案 */
export function orderCompactLabel(status: string): string {
  if (status === 'deposit_paid') return '已付定金'
  return orderStatusLabel(status)
}

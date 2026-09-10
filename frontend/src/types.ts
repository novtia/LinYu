export interface User {
  id: string
  username: string
  email?: string | null
  role: 'admin' | 'user'
  disabled: boolean
  created_at: string
}

export interface Category {
  id: number
  name: string
  sort_order: number
  enabled: boolean
  created_at: string
}

export interface Product {
  id: number
  name: string
  price: number
  desc: string
  cover: string
  cover_url?: string | null
  status: 'on' | 'off'
  category_id?: number | null
  category_name?: string | null
  delivery_content?: string | null
  /** 付费文件原始名，仅管理端可见 */
  file_name?: string | null
  files?: ProductFileItem[]
  sale_mode?: 'normal' | 'commission'
  deposit_amount?: number | null
  balance_amount?: number | null
}

export interface ProductFileItem {
  id: string
  file_name: string
  is_image: boolean
  download_url?: string | null
}

export interface CartItem {
  id: number
  name: string
  price: number
  quantity: number
  delivered?: boolean
  payload?: string
  file_name?: string | null
  download_url?: string | null
  payment?: {
    id: string
    method: string
    label: string
    channel_id: string
    channel_name: string
    provider: string
  } | null
}

export interface OrderItem {
  product_id: number
  name: string
  price: number
  payload?: string | null
  file_name?: string | null
  download_url?: string | null
  files?: ProductFileItem[]
}

export interface OrderPayment {
  id: string
  kind: 'deposit' | 'balance' | 'full' | string
  amount: number
  status: string
  paid_at?: string | null
}

export interface Order {
  id: string
  user_id?: string | null
  username: string
  email?: string
  total: number
  status: string
  sale_mode?: 'normal' | 'commission'
  deposit_amount?: number | null
  balance_amount?: number | null
  word_count?: number | null
  payment_method?: string | null
  payment_provider?: string | null
  trade_no?: string | null
  paid_at?: string | null
  created_at: string
  items: OrderItem[]
  payments?: OrderPayment[]
}

export interface CheckoutResult {
  order: Order
  pay_url: string
  deliveries: Delivery[]
}

export interface Delivery {
  id: string
  order_id: string
  product_id: number
  product_name: string
  payload: string
  file_name?: string | null
  download_url?: string | null
  files?: ProductFileItem[]
  created_at: string
  username?: string
  email?: string
  sale_mode?: 'normal' | 'commission'
}

export interface PublicSettings {
  title: string
  notice: string
  allowReg: boolean
  maintain: boolean
  name: string
  debugMode?: boolean
  mailEnabled?: boolean
}

export interface EzpayConfig {
  gateway: string
  pid: string
  key: string
  notify_url: string
  return_url: string
  sitename: string
  methods: {
    alipay: boolean
    wxpay: boolean
    qqpay: boolean
  }
}

export interface AlipayPageConfig {
  app_id: string
  app_private_key: string
  alipay_public_key: string
  sandbox: boolean
  notify_url: string
  return_url: string
  methods: {
    alipay: boolean
  }
}

export interface PaymentChannel {
  id: string
  name: string
  provider: string
  enabled: boolean
  config: Record<string, unknown> & {
    pid?: string
    app_id?: string
    methods?: Partial<EzpayConfig['methods']> & Partial<AlipayPageConfig['methods']>
  }
  created_at: string
  updated_at: string
}

export interface PaymentProvider {
  id: string
  name: string
  desc: string
  docs: string
  default_config: Record<string, unknown>
}

/** 公开支付方式（结算页可选，不含密钥） */
export interface PublicPaymentMethod {
  id: string
  method: 'alipay' | 'wxpay' | 'qqpay' | string
  label: string
  channel_id: string
  channel_name: string
  provider: string
  provider_name: string
}

export interface PublicPaymentMethods {
  methods: PublicPaymentMethod[]
}

export interface MailSettings {
  enabled: boolean
  secret_id: string
  secret_key: string
  region: string
  from_email: string
  from_alias: string
  reply_to: string
  template_buyer: string
  template_reset: string
  template_register: string
  template_login: string
}

export interface SysSettings {
  name: string
  email: string
  notify: string
  autoDeliver: boolean
  allowReg: boolean
  maintain: boolean
  debugMode: boolean
  mail: MailSettings
}

export interface SiteSettings {
  title: string
  keywords: string
  desc: string
  notice: string
}

export interface Settings {
  sys: SysSettings
  site: SiteSettings
}

export type CommissionMsgType = 'text' | 'image' | 'file' | 'emoji' | 'system' | 'delivery'
export type CommissionRole = 'user' | 'admin' | 'system'

export interface CommissionMessage {
  id: number
  role: CommissionRole
  type: CommissionMsgType
  body: string
  file_name?: string | null
  file_size?: number | null
  file_url?: string | null
  created_at: string
  recalled_at?: string | null
  can_recall?: boolean
  order_status?: string | null
}

export interface CommissionThread {
  id: string
  user_id: string
  username: string
  product_id: number
  product_name: string
  order_id?: string | null
  unread_admin: number
  unread_user: number
  last_preview?: string | null
  last_at?: string | null
  last_kind?: string | null
  has_deposit: boolean
  order_status?: string | null
  word_count?: number | null
  deposit_amount?: number | null
  balance_amount?: number | null
  created_at: string
  updated_at: string
}

export interface CommissionMessagesResult {
  messages: CommissionMessage[]
  unread: number
  has_more: boolean
  order_status?: string | null
}

export interface CommissionThreadList {
  items: CommissionThread[]
  total: number
}

export type ChatSocketEvent =
  | {
      type: 'message'
      thread_id: string
      message_user: CommissionMessage
      message_admin: CommissionMessage
      thread: CommissionThread
    }
  | {
      type: 'recall'
      thread_id: string
      messages_user: CommissionMessage[]
      messages_admin: CommissionMessage[]
      thread: CommissionThread
    }
  | {
      type: 'read'
      thread_id: string
      role: 'user' | 'admin'
      thread: CommissionThread
    }

export interface DashboardTrendPoint {
  date: string
  orders: number
  revenue: number
}

export interface DashboardTodo {
  key: string
  label: string
  count: number
  hint: string
  to: string
  urgent: boolean
}

export interface DashboardConv {
  id: string
  user_id: string
  username: string
  product_id: number
  product_name: string
  order_id?: string | null
  preview: string
  last_at?: string | null
  unread: number
}

export interface DashboardSystem {
  payments: string
  mail_ok: boolean
  mail_label: string
  db_name: string
  db_size: string
  users: number
  products_on: number
}

export interface Dashboard {
  today_orders: number
  yesterday_orders: number
  today_revenue: number
  yesterday_revenue: number
  pending: number
  pending_overdue: number
  unread_threads: number
  unread_users: number
  users: number
  products_on: number
  deliveries: number
  recent_orders: Order[]
  trend: DashboardTrendPoint[]
  todos: DashboardTodo[]
  conversations: DashboardConv[]
  system: DashboardSystem
}

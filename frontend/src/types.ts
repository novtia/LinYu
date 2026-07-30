export type ProductType = 'key' | 'file' | 'code'

export interface User {
  id: string
  username: string
  role: 'admin' | 'user'
  disabled: boolean
  created_at: string
}

export interface Product {
  id: string
  name: string
  type: ProductType
  price: number
  desc: string
  cover: string
  cover_url?: string | null
  tag: string
  status: 'on' | 'off'
  file_name?: string | null
  has_file?: boolean
}

export interface CartItem {
  id: string
  name: string
  price: number
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
  product_id: string
  name: string
  price: number
  payload?: string | null
  file_name?: string | null
  download_url?: string | null
}

export interface Order {
  id: string
  username: string
  total: number
  status: string
  payment_method?: string | null
  payment_provider?: string | null
  trade_no?: string | null
  paid_at?: string | null
  created_at: string
  items: OrderItem[]
}

export interface CheckoutResult {
  order: Order
  pay_url: string
  deliveries: Delivery[]
}

export interface Delivery {
  id: string
  order_id: string
  product_id: string
  product_name: string
  payload: string
  file_name?: string | null
  download_url?: string | null
  created_at: string
}

export interface PublicSettings {
  title: string
  notice: string
  allowReg: boolean
  maintain: boolean
  name: string
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

export interface PaymentChannel {
  id: string
  name: string
  provider: string
  enabled: boolean
  config: Record<string, unknown> & {
    pid?: string
    methods?: Partial<EzpayConfig['methods']>
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

export interface SysSettings {
  name: string
  email: string
  notify: string
  autoDeliver: boolean
  allowReg: boolean
  maintain: boolean
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

export interface Dashboard {
  today_orders: number
  users: number
  products_on: number
  deliveries: number
  recent_orders: Order[]
}

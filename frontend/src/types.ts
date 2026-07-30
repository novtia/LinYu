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
  created_at: string
  items: OrderItem[]
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

export interface PaySettings {
  alipay: boolean
  wechat: boolean
  usdt: boolean
  alipayPid: string
  alipayKey: string
  wechatMch: string
  wechatKey: string
  usdtAddr: string
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
  pay: PaySettings
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

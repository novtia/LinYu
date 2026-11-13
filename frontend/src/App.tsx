import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ChatSocketProvider } from './context/ChatSocketContext'
import { CartProvider } from './context/CartContext'
import { PurchaseResultProvider } from './context/PurchaseResultContext'
import { ToastProvider } from './context/ToastContext'
import { ShopLayout } from './components/ShopLayout'
import { ShopPage } from './pages/ShopPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { OrdersListPage } from './pages/OrdersListPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { UsdtPayPage } from './pages/UsdtPayPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { DashboardPage } from './pages/admin/DashboardPage'
import { ProductsPage } from './pages/admin/ProductsPage'
import { ProductFormPage } from './pages/admin/ProductFormPage'
import { UsersPage } from './pages/admin/UsersPage'
import { RevenuePage } from './pages/admin/RevenuePage'
import { PaymentChannelFormPage } from './pages/admin/PaymentChannelFormPage'
import { SettingsDesk } from './pages/admin/SettingsDesk'
import { ConversationsPage } from './pages/admin/ConversationsPage'
import { MyCommissionsPage } from './pages/MyCommissionsPage'
import { ShelfPage } from './pages/ShelfPage'
import { ReaderPage } from './pages/ReaderPage'

function ToRevenue() {
  const { id } = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`/admin/revenue${id ? `/${encodeURIComponent(id)}` : ''}${search}${hash}`} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ChatSocketProvider>
          <CartProvider>
            <ToastProvider>
              <PurchaseResultProvider>
                <Routes>
                <Route element={<ShopLayout />}>
                  <Route path="/" element={<ShopPage />} />
                  <Route path="/product/:id" element={<ProductDetailPage />} />
                  <Route path="/checkout" element={<CheckoutPage />} />
                  <Route path="/pay/usdt/:paymentId" element={<UsdtPayPage />} />
                  <Route path="/orders" element={<OrdersListPage />} />
                  <Route path="/orders/:id" element={<OrderDetailPage />} />
                  <Route path="/commissions" element={<MyCommissionsPage />} />
                  <Route path="/shelf" element={<ShelfPage />} />
                </Route>
                <Route path="/read/:id" element={<ReaderPage />} />
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="products/new" element={<ProductFormPage />} />
                  <Route path="products/:id/edit" element={<ProductFormPage />} />
                  <Route path="categories" element={<Navigate to="/admin/products?focus=categories" replace />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="orders" element={<ToRevenue />} />
                  <Route path="orders/:id" element={<ToRevenue />} />
                  <Route path="revenue/:id?" element={<RevenuePage />} />
                  <Route path="conversations" element={<ConversationsPage />} />
                  <Route path="deliveries" element={<Navigate to="/admin/revenue#orders" replace />} />
                  <Route path="deliveries/:id" element={<Navigate to="/admin/revenue#orders" replace />} />
                  <Route path="payment" element={<div className="lx-desk -m-4 min-h-full bg-fog px-5 py-6 md:-m-6 md:px-7 md:py-7"><SettingsDesk focus="payment" /></div>} />
                  <Route path="payment/new" element={<PaymentChannelFormPage />} />
                  <Route path="payment/:id" element={<PaymentChannelFormPage />} />
                  <Route path="system" element={<div className="lx-desk -m-4 min-h-full bg-fog px-5 py-6 md:-m-6 md:px-7 md:py-7"><SettingsDesk focus="system" /></div>} />
                  <Route path="website" element={<div className="lx-desk -m-4 min-h-full bg-fog px-5 py-6 md:-m-6 md:px-7 md:py-7"><SettingsDesk focus="website" /></div>} />
                </Route>
                </Routes>
              </PurchaseResultProvider>
            </ToastProvider>
          </CartProvider>
        </ChatSocketProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

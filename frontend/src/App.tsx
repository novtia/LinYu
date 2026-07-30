import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import { ToastProvider } from './context/ToastContext'
import { ShopLayout } from './components/ShopLayout'
import { ShopPage } from './pages/ShopPage'
import { ProductDetailPage } from './pages/ProductDetailPage'
import { OrdersListPage } from './pages/OrdersListPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { DashboardPage } from './pages/admin/DashboardPage'
import { ProductsPage } from './pages/admin/ProductsPage'
import { ProductFormPage } from './pages/admin/ProductFormPage'
import { UsersPage } from './pages/admin/UsersPage'
import { OrdersPage } from './pages/admin/OrdersPage'
import { DeliveriesPage } from './pages/admin/DeliveriesPage'
import { PaymentPage } from './pages/admin/PaymentPage'
import { SystemPage } from './pages/admin/SystemPage'
import { WebsitePage } from './pages/admin/WebsitePage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <ToastProvider>
            <Routes>
              <Route element={<ShopLayout />}>
                <Route path="/" element={<ShopPage />} />
                <Route path="/product/:id" element={<ProductDetailPage />} />
                <Route path="/orders" element={<OrdersListPage />} />
                <Route path="/orders/:id" element={<OrderDetailPage />} />
              </Route>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="products/new" element={<ProductFormPage />} />
                <Route path="products/:id/edit" element={<ProductFormPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="deliveries" element={<DeliveriesPage />} />
                <Route path="payment" element={<PaymentPage />} />
                <Route path="system" element={<SystemPage />} />
                <Route path="website" element={<WebsitePage />} />
              </Route>
            </Routes>
          </ToastProvider>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

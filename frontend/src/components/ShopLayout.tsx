import { Outlet } from 'react-router-dom'
import { Topbar } from './Topbar'
import { CartDrawer } from './CartDrawer'
import { AuthModal } from './AuthModal'

export function ShopLayout() {
  return (
    <>
      <Topbar />
      <Outlet />
      <CartDrawer />
      <AuthModal />
    </>
  )
}

import { Outlet } from 'react-router-dom'
import { Topbar } from './Topbar'
import { AuthModal } from './AuthModal'

export function ShopLayout() {
  return (
    <>
      <Topbar />
      <Outlet />
      <AuthModal />
    </>
  )
}

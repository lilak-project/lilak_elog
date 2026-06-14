import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="sticky top-0 z-50">
        <Navbar />
      </div>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 pt-2 pb-10">
        <Outlet />
      </main>
    </div>
  )
}

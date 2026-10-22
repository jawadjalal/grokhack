'use client'

import { usePathname } from 'next/navigation'
import { Sidebar, type SidebarCounts } from '@/components/Sidebar'

// App frame: sticky sidebar plus the page. The page area re-mounts on route change so it fades and rises in.
// The window scrolls (not an inner box) so each page's own sticky header keeps working.
export function Shell({ children, counts }: { children: React.ReactNode; counts?: SidebarCounts }) {
  const path = usePathname() ?? '/'
  return (
    <div className="bk-shell">
      <Sidebar counts={counts} />
      <main className="bk-main">
        <div key={path} className="bk-page">
          {children}
        </div>
      </main>
    </div>
  )
}

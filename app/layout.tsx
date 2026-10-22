import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata } from 'next'
import { Shell } from '@/components/Shell'
import { loadMap } from '@/lib/data'
import './globals.css'

export const metadata: Metadata = {
  title: 'Backer',
  description: 'Find who will back your event.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Sidebar counts come from the same map every page reads.
  const map = await loadMap().catch(() => null)
  const counts = map ? { '/crm': map.sponsors.length, '/network': new Set(map.backings.map(b => b.event.toLowerCase().trim())).size } : {}
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Shell counts={counts}>{children}</Shell>
      </body>
    </html>
  )
}

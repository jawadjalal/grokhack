import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import type { Metadata } from 'next'
import { Shell } from '@/components/Shell'
import { loadMap } from '@/lib/data'
import london from '@/data/london.json'
import './globals.css'

export const metadata: Metadata = {
  title: 'Backer',
  description: 'Find who will back your event.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Sidebar counts come from the same map every page reads.
  const map = await loadMap().catch(() => null)
  // CRM lists every domain from the map plus the scraped london.json, so count the same union.
  const dom = (d: string) => d.trim().toLowerCase().replace(/^www\./, '')
  const crmCount = new Set([...(map?.sponsors ?? []), ...(london.sponsors as { domain: string }[])].map(s => dom(s.domain))).size
  const counts = map ? { '/crm': crmCount, '/network': new Set(map.backings.map(b => b.event.toLowerCase().trim())).size } : {}
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Shell counts={counts}>{children}</Shell>
      </body>
    </html>
  )
}

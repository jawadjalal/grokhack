'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon } from '@/components/Mark'

export type SidebarCounts = Partial<Record<'/' | '/pipeline' | '/crm' | '/network' | '/memory', number>>

const NAV = [
  { href: '/', label: 'Find backers', icon: 'search' },
  { href: '/pipeline', label: 'Pipeline', icon: 'chart' },
  { href: '/crm', label: 'CRM', icon: 'crm' },
  { href: '/network', label: 'Network', icon: 'globe' },
  { href: '/memory', label: 'Memory', icon: 'sparkle' },
] as const

const ITEM_H = 34
const ITEM_GAP = 2

function activeIndex(path: string) {
  const i = NAV.findIndex(n => (n.href === '/' ? path === '/' : path === n.href || path.startsWith(n.href + '/')))
  return i
}

// Reads the saved location label, tolerating a plain string or a JSON object.
function readLocation(): string {
  try {
    const raw = window.localStorage.getItem('backer.location.v1')
    if (!raw) return ''
    try {
      const v = JSON.parse(raw)
      if (typeof v === 'string') return v
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        for (const k of ['label', 'name', 'city', 'display', 'address']) if (typeof o[k] === 'string' && o[k]) return o[k] as string
      }
      return ''
    } catch {
      return raw
    }
  } catch {
    return ''
  }
}

export function Sidebar({ counts = {} }: { counts?: SidebarCounts }) {
  const path = usePathname() ?? '/'
  const idx = activeIndex(path)
  const [place, setPlace] = useState('')

  useEffect(() => {
    setPlace(readLocation())
    const on = (e: StorageEvent) => { if (!e.key || e.key === 'backer.location.v1') setPlace(readLocation()) }
    window.addEventListener('storage', on)
    return () => window.removeEventListener('storage', on)
  }, [path])

  return (
    <>
      <style>{CSS}</style>
      <aside className="bk-side" aria-label="Primary">
        <Link href="/" className="bk-brand" aria-label="Backer home">
          <span className="bk-brand-mark"><Icon name="star" size={22} /></span>
          <span className="bk-label bk-brand-name">Backer</span>
        </Link>

        <nav className="bk-nav">
          <span
            className="bk-hl"
            aria-hidden
            style={{ opacity: idx < 0 ? 0 : 1, transform: `translateY(${Math.max(idx, 0) * (ITEM_H + ITEM_GAP)}px)` }}
          />
          {NAV.map((n, i) => {
            const on = i === idx
            const count = counts[n.href]
            return (
              <Link
                key={n.href}
                href={n.href}
                title={n.label}
                aria-current={on ? 'page' : undefined}
                className={'bk-item' + (on ? ' bk-on' : '')}
                style={{ animationDelay: `${60 + i * 45}ms` }}
              >
                <span className="bk-ico"><Icon name={n.icon} size={17} /></span>
                <span className="bk-label bk-text">{n.label}</span>
                {typeof count === 'number' && count > 0 ? <span className="bk-label bk-count mono">{count}</span> : null}
              </Link>
            )
          })}
        </nav>

        <div className="bk-foot">
          {place ? (
            <div className="bk-place" title={place}>
              <span className="bk-side-dot" />
              <span className="bk-label bk-place-text">{place}</span>
            </div>
          ) : null}
          <a className="bk-oss" href="https://github.com/jawadjalal/grokhack" target="_blank" rel="noreferrer" title="Open source, MIT">
            <span className="bk-ico"><Icon name="flag" size={15} /></span>
            <span className="bk-label">Open source, MIT</span>
          </a>
        </div>
      </aside>
    </>
  )
}

const CSS = `
:root { --side-w: 232px; }
.bk-side { position: sticky; top: 0; align-self: flex-start; height: 100vh; width: 232px; flex: none; display: flex; flex-direction: column; padding: 14px 10px 12px; background: var(--bg); border-right: 1px solid var(--divider); z-index: 20; transition: width .3s var(--ease); }
.bk-brand { display: flex; align-items: center; gap: 9px; height: 38px; padding: 0 8px; margin-bottom: 14px; color: var(--ink); text-decoration: none; animation: bk-in .5s var(--ease) both; }
.bk-brand-mark { display: inline-flex; transition: transform .5s var(--ease); }
.bk-brand:hover .bk-brand-mark { transform: rotate(72deg) scale(1.08); }
.bk-brand-name { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.bk-nav { position: relative; display: flex; flex-direction: column; gap: ${ITEM_GAP}px; }
.bk-hl { position: absolute; left: 0; right: 0; top: 0; height: ${ITEM_H}px; border-radius: var(--r-button); background: var(--chip); box-shadow: inset 0 0 0 1px var(--divider); transition: transform .38s var(--ease), opacity .2s var(--ease); pointer-events: none; }
.bk-item { position: relative; display: flex; align-items: center; gap: 10px; height: ${ITEM_H}px; padding: 0 10px; border-radius: var(--r-button); color: var(--ink2); text-decoration: none; font-size: 13.5px; font-weight: 500; white-space: nowrap; transition: color .15s var(--ease), background .15s var(--ease); animation: bk-in .5s var(--ease) both; }
.bk-item:hover { color: var(--ink); background: var(--hover); }
.bk-item.bk-on { color: var(--ink); font-weight: 600; background: transparent; }
.bk-item.bk-on:hover { background: transparent; }
.bk-ico { display: inline-flex; width: 18px; justify-content: center; flex: none; opacity: .72; transition: opacity .15s var(--ease), transform .25s var(--ease); }
.bk-item:hover .bk-ico { transform: translateX(1px) scale(1.06); }
.bk-on .bk-ico { opacity: 1; }
.bk-text { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.bk-count { font-size: 11.5px; color: var(--ink3); font-weight: 500; }
.bk-foot { margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding-top: 10px; border-top: 1px solid var(--divider); animation: bk-in .5s var(--ease) .35s both; }
.bk-place { display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 10px; color: var(--ink2); font-size: 12.5px; }
.bk-place-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bk-side-dot { width: 7px; height: 7px; border-radius: 2px; background: var(--go); flex: none; margin: 0 5.5px; animation: blink 2.4s ease-in-out infinite; }
.bk-oss { display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 10px; border-radius: var(--r-button); color: var(--ink3); font-size: 12.5px; text-decoration: none; white-space: nowrap; transition: background .15s var(--ease), color .15s var(--ease); }
.bk-oss:hover { background: var(--hover); color: var(--ink); }
.bk-shell { display: flex; min-height: 100vh; background: var(--canvas); }
.bk-main { flex: 1; min-width: 0; }
.bk-page { animation: bk-page .38s var(--ease) backwards; }
@keyframes bk-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
@keyframes bk-page { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 899px) {
  .bk-side { width: 56px; padding-left: 8px; padding-right: 8px; }
  .bk-label { display: none; }
  .bk-brand, .bk-item, .bk-oss, .bk-place { justify-content: center; padding: 0; }
  .bk-item { gap: 0; }
  .bk-side-dot { margin: 0; }
  :root { --side-w: 56px; }
}
@media (prefers-reduced-motion: reduce) { .bk-hl, .bk-side, .bk-brand-mark, .bk-ico { transition: none !important; } .bk-page, .bk-item, .bk-brand, .bk-foot { animation: none !important; } }
`

// Companies always appear with their real logo, never a monogram.
export function Mark({ domain, size = 22 }: { domain: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 5, flex: 'none', background: 'var(--card)', boxShadow: '0 0 0 1px var(--divider)' }}
    />
  )
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/icons/${name}.svg`} alt="" width={size} height={size} style={{ flex: 'none' }} />
}

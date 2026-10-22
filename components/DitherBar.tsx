// 4×4 Bayer dither, 2px cells, from the Ignaru kit. Solid up to the value,
// then a dithered falloff, then the empty track. Never behind body text.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export function DitherBar({ value, color = 'var(--go)', width = 108, height = 12 }: { value: number; color?: string; width?: number; height?: number }) {
  const cell = 2
  const cols = width / cell
  const rows = height / cell
  const solid = Math.round((cols * value) / 100) - 10
  const rects: React.ReactNode[] = []
  for (let x = 0; x < cols; x++) {
    if (x < solid) continue
    const fade = 1 - (x - solid) / 10
    if (fade <= 0) break
    for (let y = 0; y < rows; y++) {
      if (BAYER[(y % 4) * 4 + (x % 4)] / 16 < fade) rects.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} />)
    }
  }
  return (
    <svg width={width} height={height} style={{ display: 'block', borderRadius: 2, background: 'var(--chip)' }} aria-label={`${value} out of 100`}>
      <g fill={color}>
        {solid > 0 && <rect width={solid * cell} height={height} />}
        {rects}
      </g>
    </svg>
  )
}

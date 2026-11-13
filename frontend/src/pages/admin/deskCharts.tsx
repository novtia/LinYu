import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { DeltaDir } from '../../lib/desk'

export function Spark({ values, down }: { values: number[]; down?: boolean }) {
  const w = 72
  const h = 28
  const nums = values.length ? values : [0]
  const max = Math.max(...nums)
  const min = Math.min(...nums)
  const span = max - min || 1
  const pts = nums
    .map((v, i) => {
      const x = nums.length === 1 ? w / 2 : (i / (nums.length - 1)) * w
      const y = h - 3 - ((v - min) / span) * (h - 8)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ color: down ? 'var(--danger)' : 'var(--teal)' }}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function Kpis({
  items,
  four,
}: {
  four?: boolean
  items: {
    label: string
    em?: string
    value: ReactNode
    delta?: { dir: DeltaDir; text: string }
    spark?: number[]
  }[]
}) {
  return (
    <section className={four ? 'kpis k4' : 'kpis'} aria-label="指标">
      {items.map((item) => (
        <article className="kpi" key={item.label}>
          <div className="lbl">
            {item.label}
            {item.em ? <em>{item.em}</em> : null}
          </div>
          <div className="val">{item.value}</div>
          {item.delta || item.spark ? (
            <div className="sub">
              {item.delta ? <span className={`delta ${item.delta.dir}`}>{item.delta.text}</span> : <span />}
              {item.spark ? <Spark values={item.spark} down={item.delta?.dir === 'down'} /> : null}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  )
}

type Series = { values: number[]; fill: string; stroke?: string }

export function AreaChart({
  series,
  labels,
  tip,
  height = 228,
}: {
  series: Series[]
  labels: string[]
  tip?: (index: number) => ReactNode
  height?: number
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const n = Math.max(labels.length, series[0]?.values.length || 0, 1)
  const w = 720
  const padL = 44
  const padR = 8
  const padT = 16
  const padB = 26
  const cumul: number[][] = []
  series.forEach((s, idx) => {
    const prev = idx ? cumul[idx - 1] : Array(n).fill(0)
    cumul.push(Array.from({ length: n }, (_, i) => (prev[i] || 0) + (s.values[i] || 0)))
  })
  const top = cumul[cumul.length - 1] || Array(n).fill(0)
  const max = Math.max(...top, 1) * 1.15
  const x = (i: number) => padL + (n === 1 ? (w - padL - padR) / 2 : (i / (n - 1)) * (w - padL - padR))
  const y = (v: number) => padT + (height - padT - padB) * (1 - v / max)
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = (arr: number[]) => `${line(arr)} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const step = n > 16 ? Math.ceil(n / 6) : 1
  const grids = [0, 0.5, 1].map((g) => {
    const val = Math.round(max * g)
    const yy = y(val)
    const text = val >= 1000 ? `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k` : String(val)
    return { yy, text }
  })

  function move(e: MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget.getBoundingClientRect()
    const box = wrap.current?.getBoundingClientRect()
    const rel = Math.min(1, Math.max(0, (e.clientX - svg.left) / svg.width))
    const i = Math.round(rel * (n - 1))
    setHover({
      i,
      x: e.clientX - (box?.left || 0),
      y: e.clientY - (box?.top || 0),
    })
  }

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
      >
        {grids.map((g) => (
          <g key={g.text}>
            <line x1={padL} y1={g.yy} x2={w - padR} y2={g.yy} stroke="rgba(20,32,28,.08)" />
            <text x={padL - 6} y={g.yy + 3} textAnchor="end" fill="#6b7c74" fontSize="10" fontFamily="JetBrains Mono, sans-serif">
              {g.text}
            </text>
          </g>
        ))}
        {[...cumul].reverse().map((arr, rev) => {
          const idx = cumul.length - 1 - rev
          const s = series[idx]
          return <path key={idx} d={area(arr)} fill={s?.fill || '#0f6e5c'} />
        })}
        {cumul.map((arr, idx) =>
          series[idx]?.stroke ? (
            <path key={`s${idx}`} d={line(arr)} fill="none" stroke={series[idx].stroke} strokeWidth="1.4" />
          ) : null,
        )}
        {labels.map((lb, i) =>
          i % step !== 0 && i !== n - 1 ? null : (
            <text key={lb + i} x={x(i)} y={height - 6} textAnchor="middle" fill="#6b7c74" fontSize="10" fontFamily="JetBrains Mono, sans-serif">
              {lb.replace('时', '')}
            </text>
          ),
        )}
        {hover ? (
          <line x1={x(hover.i)} x2={x(hover.i)} y1={padT} y2={height - padB} stroke="#14201c" strokeWidth="1" opacity="0.35" />
        ) : null}
      </svg>
      {hover && tip ? (
        <div className="chart-tip" style={{ left: hover.x, top: hover.y }}>
          {tip(hover.i)}
        </div>
      ) : null}
    </div>
  )
}

export function StackedBarChart({
  series,
  labels,
  tip,
  height = 240,
}: {
  series: { values: number[]; color: string }[]
  labels: string[]
  tip?: (index: number) => ReactNode
  height?: number
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const n = Math.max(labels.length, series[0]?.values.length || 0, 1)
  const w = 720
  const padL = 44
  const padR = 14
  const padT = 14
  const padB = 26
  const plotW = w - padL - padR
  const slot = plotW / n
  const barW = Math.max(4, Math.min(20, slot * 0.62))
  const xCenter = (i: number) => padL + slot * (i + 0.5)
  const totals = Array.from({ length: n }, (_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0))
  const max = Math.max(...totals, 1) * 1.15
  const baseH = height - padB
  const y = (v: number) => padT + (baseH - padT) * (1 - v / max)
  const step = n > 14 ? Math.ceil(n / 6) : 1
  const grids = [0, 0.5, 1].map((g) => {
    const val = Math.round(max * g)
    const yy = y(val)
    const text = val >= 1000 ? `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k` : String(val)
    return { yy, text, dashed: g > 0 }
  })

  function move(e: MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget.getBoundingClientRect()
    const box = wrap.current?.getBoundingClientRect()
    const relX = ((e.clientX - svg.left) / svg.width) * w
    const i = Math.min(n - 1, Math.max(0, Math.floor((relX - padL) / slot)))
    setHover({
      i,
      x: e.clientX - (box?.left || 0),
      y: e.clientY - (box?.top || 0),
    })
  }

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
        style={{ height }}
      >
        {grids.map((g, idx) => (
          <g key={idx}>
            <line
              x1={padL}
              y1={g.yy}
              x2={w - padR}
              y2={g.yy}
              stroke="rgba(20,32,28,.08)"
              strokeDasharray={g.dashed ? '3 3' : undefined}
            />
            <text x={padL - 8} y={g.yy + 3} textAnchor="end" fill="#6b7c74" fontSize="10" fontFamily="JetBrains Mono, sans-serif">
              {g.text}
            </text>
          </g>
        ))}

        {Array.from({ length: n }, (_, i) => {
          const cx = xCenter(i)
          const bx = cx - barW / 2
          const sum = totals[i]
          if (!sum) {
            return <rect key={i} x={bx} y={baseH - 2} width={barW} height={2} fill="rgba(20,32,28,.12)" />
          }
          let curY = baseH
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = s.values[i] || 0
                if (!v) return null
                const bh = Math.max(1, (baseH - padT) * (v / max))
                curY -= bh
                return <rect key={si} x={bx} y={curY} width={barW} height={bh} fill={s.color} />
              })}
            </g>
          )
        })}

        {labels.map((lb, i) =>
          i % step !== 0 && i !== n - 1 ? null : (
            <text key={lb + i} x={xCenter(i)} y={height - 6} textAnchor="middle" fill="#6b7c74" fontSize="10" fontFamily="JetBrains Mono, sans-serif">
              {lb}
            </text>
          ),
        )}

        {hover ? (
          <rect
            x={padL + slot * hover.i}
            y={padT}
            width={slot}
            height={baseH - padT}
            fill="rgba(15,110,92,.08)"
            pointerEvents="none"
          />
        ) : null}
      </svg>
      {hover && tip ? (
        <div className="chart-tip" style={{ left: hover.x, top: hover.y }}>
          {tip(hover.i)}
        </div>
      ) : null}
    </div>
  )
}

export function TwinBars({ reg, buy, labels }: { reg: number[]; buy: number[]; labels: string[] }) {
  const w = 720
  const h = 164
  const padL = 28
  const padR = 8
  const padT = 10
  const padB = 22
  const n = Math.max(reg.length, 1)
  const max = Math.max(...reg, ...buy, 1) * 1.2
  const slot = (w - padL - padR) / n
  const x = (i: number) => padL + slot * (i + 0.5)
  const bw = Math.max(10, slot * 0.56)
  const inner = h - padT - padB
  const step = n > 10 ? Math.ceil(n / 7) : 1
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: h }}>
        {reg.map((v, i) => {
          const bh = inner * (v / max)
          const bb = inner * ((buy[i] || 0) / max)
          const left = x(i) - bw / 2
          return (
            <g key={i}>
              <rect x={left} y={padT + inner - bh} width={bw} height={Math.max(bh, 0)} rx="2" fill="rgba(15,110,92,.2)" />
              <rect x={left} y={padT + inner - bb} width={bw} height={Math.max(bb, 0)} rx="2" fill="#0f6e5c" />
            </g>
          )
        })}
        {labels.map((lb, i) =>
          i % step !== 0 && i !== n - 1 ? null : (
            <text key={lb + i} x={x(i)} y={h - 4} textAnchor="middle" fill="#6b7c74" fontSize="10" fontFamily="JetBrains Mono, sans-serif">
              {lb.replace('时', '')}
            </text>
          ),
        )}
      </svg>
    </div>
  )
}

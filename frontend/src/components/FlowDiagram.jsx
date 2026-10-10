import { entityTone } from './bits'

const W = 196
const H = 70
const GAPX = 64
const GAPY = 16
const PAD = 12

/** Read-only dependency diagram: one column per step, stages in the same column can run at the same time. */
export default function FlowDiagram({ flow, selected, onSelect, states }) {
  const by = Object.fromEntries(flow.stages.map((s) => [s.key, s]))
  const pos = {}
  flow.layers.forEach((layer, c) => layer.forEach((k, r) => { pos[k] = { x: PAD + c * (W + GAPX), y: PAD + 26 + r * (H + GAPY) } }))
  const rows = Math.max(...flow.layers.map((l) => l.length))
  const width = PAD * 2 + flow.layers.length * W + (flow.layers.length - 1) * GAPX
  const height = PAD * 2 + 26 + rows * H + (rows - 1) * GAPY

  const edges = flow.stages.flatMap((s) => s.requires.filter((r) => pos[r]).map((r) => {
    const a = pos[r]
    const b = pos[s.key]
    const x1 = a.x + W
    const y1 = a.y + H / 2
    const x2 = b.x
    const y2 = b.y + H / 2
    const mx = (x1 + x2) / 2
    return { id: `${r}>${s.key}`, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, hot: selected && (selected === r || selected === s.key) }
  }))

  return (
    <div className="flowdiagram" role="group" aria-label="Workflow diagram">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Workflow with ${flow.stages.length} stages in ${flow.layers.length} steps`}>
        <defs>
          <marker id="fd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="fd-arrowhead" />
          </marker>
        </defs>
        {flow.layers.map((layer, c) => (
          <text key={c} x={PAD + c * (W + GAPX)} y={PAD + 12} className="fd-col">
            {layer.length > 1 ? `Step ${c + 1} · ${layer.length} in parallel` : `Step ${c + 1}`}
          </text>
        ))}
        {edges.map((e) => <path key={e.id} d={e.d} className={`fd-edge ${e.hot ? 'hot' : ''}`} markerEnd="url(#fd-arrow)" />)}
        {flow.stages.map((s) => {
          const p = pos[s.key]
          const st = states?.[s.key]
          return (
            <g key={s.key} transform={`translate(${p.x},${p.y})`} className={`fd-node tone-${entityTone(s.entity)} ${selected === s.key ? 'on' : ''} ${st ? `st-${st}` : ''}`}
              tabIndex={onSelect ? 0 : undefined} role={onSelect ? 'button' : undefined} aria-label={s.name}
              onClick={() => onSelect?.(s.key)} onKeyDown={(e) => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(s.key) } }}>
              <rect width={W} height={H} rx={10} />
              <text x={16} y={26} className="fd-name">{s.name.length > ((s.milestone || s.optional) ? 19 : 24) ? `${s.name.slice(0, (s.milestone || s.optional) ? 18 : 23)}…` : s.name}</text>
              <text x={16} y={46} className="fd-sub">{s.approver.length > 28 ? `${s.approver.slice(0, 27)}…` : s.approver}</text>
              {s.milestone && <text x={W - 16} y={26} className="fd-flag" textAnchor="end">LOCK</text>}
              {s.optional && <text x={W - 16} y={s.milestone ? 46 : 26} className="fd-flag" textAnchor="end">opt</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Plain-language reading of the dependency graph, for people who do not read diagrams. */
export function describeFlow(flow) {
  const by = Object.fromEntries(flow.stages.map((s) => [s.key, s.name]))
  const lines = []
  const starts = flow.stages.filter((s) => !s.requires.length)
  lines.push(`${starts.map((s) => s.name).join(' and ')} ${starts.length > 1 ? 'start' : 'starts'} the project${starts.length > 1 ? ' together' : ''}.`)
  const seen = new Set()
  flow.stages.forEach((s) => {
    if (!s.requires.length) return
    const sig = s.requires.join('|')
    if (seen.has(sig)) return
    seen.add(sig)
    const same = flow.stages.filter((o) => o.requires.join('|') === sig)
    const after = s.requires.map((r) => by[r]).join(' and ')
    lines.push(same.length > 1
      ? `Once ${after} ${s.requires.length > 1 ? 'are' : 'is'} approved, ${same.map((o) => o.name).join(', ')} all run at the same time.`
      : `${s.name} starts when ${after} ${s.requires.length > 1 ? 'are all' : 'is'} approved.`)
  })
  return lines
}

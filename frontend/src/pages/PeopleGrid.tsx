import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { usePersons, type Person } from '../api/persons'
import { FaceThumbnail } from '../components/FaceThumbnail'

const COLS = 4
const CARD_MIN_WIDTH = 160
const GAP = 18
const PADDING = 28

function PersonCard({ person, onClick }: { person: Person; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: '#1a1a1f',
        borderRadius: 14,
        cursor: 'pointer',
        border: `2px solid ${hover ? '#7c6af7' : 'transparent'}`,
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'border .15s, transform .15s',
      }}
    >
      <div style={{ width: '100%', aspectRatio: '1', overflow: 'hidden', background: '#242429', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '11px 11px 0 0' }}>
        {person.thumbnail_face_id ? (
          <FaceThumbnail faceId={person.thumbnail_face_id} size={160} style={{ width: '100%', height: '100%' }} />
        ) : (
          <span style={{ fontSize: 48, opacity: 0.3 }}>?</span>
        )}
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{person.name ?? 'Unknown person'}</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
          {person.appearance_count.toLocaleString()} appearances
        </div>
        {person.date_first_seen && (
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
            {new Date(person.date_first_seen).getFullYear()} –{' '}
            {person.date_last_seen ? new Date(person.date_last_seen).getFullYear() : '…'}
          </div>
        )}
        {!person.name && (
          <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11, background: '#242429', color: '#888', borderRadius: 4, padding: '2px 6px' }}>
            Tap to name
          </span>
        )}
      </div>
    </div>
  )
}

export function PeopleGrid() {
  const [filter, setFilter] = useState<'all' | 'named' | 'unnamed'>('all')
  const [search, setSearch] = useState('')
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = usePersons()
  const navigate = useNavigate()

  const allPersons = data?.pages.flat() ?? []

  const filtered = allPersons.filter((p) => {
    if (filter === 'named' && !p.name) return false
    if (filter === 'unnamed' && p.name) return false
    if (search && !(p.name ?? '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Determine column count from container width
  const containerRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(COLS)

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width - PADDING * 2
      const c = Math.max(1, Math.floor((w + GAP) / (CARD_MIN_WIDTH + GAP)))
      setCols(c)
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Build rows for virtual scrolling
  const rows: Person[][] = []
  for (let i = 0; i < filtered.length; i += cols) {
    rows.push(filtered.slice(i, i + cols))
  }

  // Estimate card height: image aspect 1:1 at card width + info area (~80px)
  const cardWidth = containerRef.current
    ? Math.floor((containerRef.current.clientWidth - PADDING * 2 - GAP * (cols - 1)) / cols)
    : CARD_MIN_WIDTH
  const estimatedRowHeight = cardWidth + 80 + GAP

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 3,
  })

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore()
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  const totalCount = allPersons.length

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '28px 28px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>People</div>
        <div style={{ color: '#888', fontSize: 14, marginTop: 4 }}>
          {totalCount} people loaded{hasNextPage ? ' (more available)' : ''}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            style={{
              flex: 1, background: '#1a1a1f', border: '1px solid #2e2e36',
              borderRadius: 10, padding: '9px 14px', color: '#e8e8f0', fontSize: 14,
            }}
          />
          {(['all', 'named', 'unnamed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: '1px solid',
                background: filter === f ? '#7c6af7' : '#1a1a1f',
                borderColor: filter === f ? '#7c6af7' : '#2e2e36',
                color: filter === f ? '#fff' : '#888',
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
          Loading…
        </div>
      ) : (
        <div
          ref={parentRef}
          style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              padding: `${PADDING}px ${PADDING}px 0`,
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: virtualRow.start + PADDING,
                    left: PADDING,
                    right: PADDING,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gap: GAP,
                  }}
                >
                  {row.map((p) => (
                    <PersonCard key={p.id} person={p} onClick={() => navigate(`/person/${p.id}`)} />
                  ))}
                </div>
              )
            })}
          </div>

          {filtered.length === 0 && (
            <div style={{ color: '#555', textAlign: 'center', paddingTop: 40 }}>
              No people found. Start indexing a drive to detect faces.
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {isFetchingNextPage && (
            <div style={{ textAlign: 'center', padding: '16px', color: '#555', fontSize: 14 }}>
              Loading more…
            </div>
          )}

          {hasNextPage && !isFetchingNextPage && (
            <div style={{ textAlign: 'center', padding: '16px 28px 28px' }}>
              <button
                onClick={() => fetchNextPage()}
                style={{
                  padding: '9px 24px', borderRadius: 8, background: '#1a1a1f',
                  border: '1px solid #2e2e36', color: '#888', fontSize: 14, cursor: 'pointer',
                }}
              >
                Load more
              </button>
            </div>
          )}

          {!hasNextPage && filtered.length > 0 && (
            <div style={{ height: 28 }} />
          )}
        </div>
      )}
    </div>
  )
}

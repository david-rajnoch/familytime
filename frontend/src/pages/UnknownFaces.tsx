import { useState, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useUnknownFaces, usePersons, useAssignFace, type Appearance } from '../api/persons'
import { FaceThumbnail } from '../components/FaceThumbnail'
import { useUIStore } from '../store/ui'

const COLS = 6
const CARD_MIN_WIDTH = 100
const GAP = 10
const PADDING = 28

function UnknownFaceCard({ appearance, playlist }: { appearance: Appearance; playlist: Appearance[] }) {
  const [showPicker, setShowPicker] = useState(false)
  const { data: personsData } = usePersons()
  const persons = personsData?.pages.flat() ?? []
  const assign = useAssignFace()
  const openViewer = useUIStore((s) => s.openViewer)
  const [hover, setHover] = useState(false)

  const handleAssign = async (personId: number) => {
    await assign.mutateAsync({ personId, faceId: appearance.face_id })
    setShowPicker(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative', aspectRatio: '1', borderRadius: 10,
          overflow: 'hidden', cursor: 'pointer',
          border: `2px solid ${hover ? '#7c6af7' : 'transparent'}`,
        }}
      >
        <FaceThumbnail faceId={appearance.face_id} size={100} style={{ width: '100%', height: '100%' }} />

        {hover && (
          <div
            onClick={() => setShowPicker(true)}
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'rgba(124,106,247,0.85)', color: '#fff',
              fontSize: 11, textAlign: 'center', padding: '5px 4px', cursor: 'pointer',
            }}
          >
            Assign
          </div>
        )}

        <div
          onClick={() => openViewer(appearance, playlist)}
          style={{
            position: 'absolute', top: 4, right: 4,
            background: 'rgba(0,0,0,0.6)', borderRadius: 4,
            padding: '2px 5px', fontSize: 10, color: '#ccc', cursor: 'pointer',
            opacity: hover ? 1 : 0, transition: 'opacity .15s',
          }}
        >
          View
        </div>
      </div>

      {/* Person picker dropdown */}
      {showPicker && (
        <>
          <div
            onClick={() => setShowPicker(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 100 }}
          />
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 101,
            background: '#1a1a1f', border: '1px solid #2e2e36', borderRadius: 10,
            padding: 8, width: 200, maxHeight: 250, overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            {persons?.map((p) => (
              <div
                key={p.id}
                onClick={() => handleAssign(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                  borderRadius: 7, cursor: 'pointer', fontSize: 13,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#242429')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {p.thumbnail_face_id && (
                  <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                    <FaceThumbnail faceId={p.thumbnail_face_id} size={28} />
                  </div>
                )}
                <span>{p.name ?? 'Unknown person'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function UnknownFaces() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useUnknownFaces()

  const allFaces = data?.pages.flat() ?? []

  // Responsive columns
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

  // Build rows
  const rows: Appearance[][] = []
  for (let i = 0; i < allFaces.length; i += cols) {
    rows.push(allFaces.slice(i, i + cols))
  }

  const cardWidth = containerRef.current
    ? Math.floor((containerRef.current.clientWidth - PADDING * 2 - GAP * (cols - 1)) / cols)
    : CARD_MIN_WIDTH
  const estimatedRowHeight = cardWidth + GAP

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 4,
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

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '28px 28px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>Unknown Faces</div>
        <div style={{ color: '#888', fontSize: 14, marginTop: 4 }}>
          {allFaces.length} faces loaded{hasNextPage ? ' (more available)' : ''} — click to assign
        </div>
      </div>

      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>Loading…</div>
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
                  {row.map((f) => (
                    <UnknownFaceCard key={f.face_id} appearance={f} playlist={allFaces} />
                  ))}
                </div>
              )
            })}
          </div>

          {allFaces.length === 0 && (
            <div style={{ color: '#555', textAlign: 'center', paddingTop: 40 }}>
              All faces are assigned!
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

          {!hasNextPage && allFaces.length > 0 && (
            <div style={{ height: 28 }} />
          )}
        </div>
      )}
    </div>
  )
}

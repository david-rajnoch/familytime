import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePerson, useTimeline, useSampleFaces, useSetName, useRemoveFace, type Appearance, type TimelineGroup } from '../api/persons'
import { FaceThumbnail } from '../components/FaceThumbnail'
import { useUIStore } from '../store/ui'
import { apiFetch } from '../api/client'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return iso }
}

function ThumbItem({ appearance, playlist, labels, onDelete }: { appearance: Appearance; playlist: Appearance[]; labels: string[]; onDelete?: () => void }) {
  const openViewer = useUIStore((s) => s.openViewer)
  const [hovered, setHovered] = useState(false)
  const isVideo = appearance.file_type === 'video'
  const ts = appearance.source_timestamp_ms

  const formatTs = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div
      onClick={() => openViewer(appearance, playlist, labels)}
      style={{
        position: 'relative', width: 140, height: 105, borderRadius: 8,
        overflow: 'hidden', cursor: 'pointer', background: '#242429',
        border: '2px solid transparent', flexShrink: 0, transition: 'border .12s, transform .12s',
      }}
      onMouseEnter={(e) => {
        setHovered(true)
        ;(e.currentTarget as HTMLElement).style.borderColor = '#7c6af7'
        ;(e.currentTarget as HTMLElement).style.transform = 'scale(1.02)'
      }}
      onMouseLeave={(e) => {
        setHovered(false)
        ;(e.currentTarget as HTMLElement).style.borderColor = 'transparent'
        ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
      }}
    >
      {isVideo ? (
        <img
          src={`/api/files/${appearance.file_id}/frame?timestamp_ms=${ts ?? 0}`}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <img
          src={`/api/files/${appearance.file_id}/photo`}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}

      {isVideo && (
        <div style={{
          position: 'absolute', bottom: 6, right: 6,
          background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '2px 6px',
          fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          ▶ Video
        </div>
      )}
      {ts != null && (
        <div style={{
          position: 'absolute', bottom: 6, left: 6,
          background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '2px 6px',
          fontSize: 11, color: '#fff',
        }}>
          {formatTs(ts)}
        </div>
      )}

      {/* Delete button — top-right, visible on hover */}
      {onDelete && hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Remove this face from person"
          style={{
            position: 'absolute', top: 5, right: 5,
            width: 22, height: 22, borderRadius: '50%', border: 'none',
            background: 'rgba(248,113,113,0.9)', color: '#fff',
            fontSize: 13, lineHeight: '22px', textAlign: 'center',
            cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

function TimelineSection({ group, playlist, labels, onDelete }: { group: TimelineGroup; playlist: Appearance[]; labels: string[]; onDelete: (faceId: number) => void }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
          {group.label}
        </span>
        <span style={{ fontSize: 12, color: '#555' }}>
          {group.date ? formatDate(group.date) : ''}
        </span>
        <div style={{ flex: 1, height: 1, background: '#2e2e36' }} />
        <span style={{ fontSize: 12, color: '#555' }}>{group.appearances.length}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {group.appearances.map((a) => (
          <ThumbItem key={a.face_id} appearance={a} playlist={playlist} labels={labels} onDelete={() => onDelete(a.face_id)} />
        ))}
      </div>
    </div>
  )
}

function SampleFaceCell({ faceId, isCurrentThumb, isSetting, isPending, onSetThumb, onDelete }: {
  faceId: number; isCurrentThumb: boolean; isSetting: boolean; isPending: boolean
  onSetThumb: () => void; onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      title={isCurrentThumb ? 'Current profile picture' : 'Set as profile picture'}
      onClick={() => { if (!isCurrentThumb && !isPending) onSetThumb() }}
      style={{
        aspectRatio: '1', overflow: 'hidden', position: 'relative',
        cursor: isCurrentThumb || isPending ? 'default' : 'pointer',
        outline: isCurrentThumb ? '2px solid #7c6af7' : '2px solid transparent',
        outlineOffset: -2, borderRadius: 2,
        opacity: isSetting ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        setHovered(true)
        if (!isCurrentThumb && !isPending) (e.currentTarget as HTMLElement).style.outline = '2px solid rgba(124,106,247,0.5)'
      }}
      onMouseLeave={(e) => {
        setHovered(false)
        if (!isCurrentThumb) (e.currentTarget as HTMLElement).style.outline = '2px solid transparent'
      }}
    >
      <FaceThumbnail faceId={faceId} size={60} style={{ width: '100%', height: '100%' }} />
      {isCurrentThumb && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(124,106,247,0.25)', fontSize: 14 }}>✓</div>
      )}
      {isSetting && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', fontSize: 12, color: '#fff' }}>…</div>
      )}
      {hovered && !isSetting && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Remove this face"
          style={{
            position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%',
            border: 'none', background: 'rgba(248,113,113,0.9)', color: '#fff',
            fontSize: 10, cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >✕</button>
      )}
    </div>
  )
}

export function PersonDetail() {
  const { personId: personIdStr } = useParams<{ personId: string }>()
  const personId = personIdStr ? parseInt(personIdStr, 10) : null
  const navigate = useNavigate()
  const { openMergeModal } = useUIStore()
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [mediaFilter, setMediaFilter] = useState<'all' | 'photo' | 'video'>('all')
  const [nameInput, setNameInput] = useState('')
  const [nameEditing, setNameEditing] = useState(false)
  const [thumbError, setThumbError] = useState<string | null>(null)
  const { data: person } = usePerson(personId ?? 0)
  const {
    data: timelineData,
    isLoading: timelineLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTimeline(personId ?? 0, order)
  const { data: sampleFaces } = useSampleFaces(personId ?? 0)
  const setName = useSetName(personId ?? 0)
  const removeFace = useRemoveFace()
  const qc = useQueryClient()

  const handleRemoveFace = (faceId: number) => {
    if (!personId) return
    removeFace.mutate({ personId, faceId }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['timeline', personId] })
        qc.invalidateQueries({ queryKey: ['sample-faces', personId] })
        qc.invalidateQueries({ queryKey: ['person', personId] })
      },
    })
  }

  const setThumbnail = useMutation({
    mutationFn: ({ pid, fid }: { pid: number; fid: number }) =>
      apiFetch(`/persons/${pid}/thumbnail/${fid}`, { method: 'POST' }),
    onSuccess: (_data, { pid }) => {
      setThumbError(null)
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['person', pid] })
      qc.invalidateQueries({ queryKey: ['sample-faces', pid] })
    },
    onError: (err: Error) => setThumbError(err.message),
  })

  if (!personId || !person) return null

  // Groups are complete (never split across pages) — just flatten
  const rawTimeline = timelineData?.pages.flat() ?? []

  // Apply media type filter — filter appearances within each group, drop empty groups
  const timeline = mediaFilter === 'all'
    ? rawTimeline
    : rawTimeline
        .map((g) => ({ ...g, appearances: g.appearances.filter((a) => a.file_type === mediaFilter) }))
        .filter((g) => g.appearances.length > 0)

  const allAppearances = timeline.flatMap((g) => g.appearances)
  const allLabels = timeline.flatMap((g) => g.appearances.map(() => g.label))

  const photoCount = rawTimeline.flatMap((g) => g.appearances).filter((a) => a.file_type === 'photo').length
  const videoCount = rawTimeline.flatMap((g) => g.appearances).filter((a) => a.file_type === 'video').length

  const handleNameSave = async () => {
    if (nameInput.trim()) {
      await setName.mutateAsync(nameInput.trim())
    }
    setNameEditing(false)
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{
        width: 280, flexShrink: 0, background: '#1a1a1f', borderRight: '1px solid #2e2e36',
        padding: 24, display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', minHeight: 0,
      }}>
        <button
          onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#888', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
        >
          ← Back
        </button>

        {/* Avatar */}
        <div style={{ width: 120, height: 120, borderRadius: '50%', overflow: 'hidden', margin: '0 auto', border: '3px solid #7c6af7' }}>
          {person.thumbnail_face_id ? (
            <FaceThumbnail faceId={person.thumbnail_face_id} size={120} />
          ) : (
            <div style={{ width: 120, height: 120, background: '#242429', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>?</div>
          )}
        </div>

        {/* Name editor */}
        {nameEditing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNameSave(); if (e.key === 'Escape') setNameEditing(false) }}
              placeholder="Enter name…"
              style={{ flex: 1, background: '#242429', border: '1px solid #7c6af7', borderRadius: 8, padding: '8px 10px', color: '#e8e8f0', fontSize: 15 }}
            />
            <button onClick={handleNameSave} style={{ padding: '8px 12px', background: '#7c6af7', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer' }}>✓</button>
          </div>
        ) : (
          <div
            onClick={() => { setNameInput(person.name ?? ''); setNameEditing(true) }}
            style={{ textAlign: 'center', fontSize: 18, fontWeight: 600, cursor: 'pointer', padding: '8px', borderRadius: 8, color: person.name ? '#e8e8f0' : '#555' }}
          >
            {person.name ?? 'Click to add name'}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            ['Appearances', person.appearance_count.toLocaleString()],
            ['First seen', formatDate(person.date_first_seen)],
            ['Last seen', formatDate(person.date_last_seen)],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#888' }}>{label}</span>
              <span style={{ fontWeight: 600 }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Sample faces */}
        {sampleFaces && sampleFaces.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Sample faces <span style={{ color: '#444', textTransform: 'none', letterSpacing: 0 }}>— click to set as profile</span>
            </div>
            {thumbError && (
              <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6, wordBreak: 'break-all' }}>{thumbError}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, borderRadius: 8, overflow: 'hidden' }}>
              {sampleFaces.slice(0, 8).map((f) => {
                const isCurrentThumb = f.face_id === person.thumbnail_face_id
                const isSetting = setThumbnail.isPending && setThumbnail.variables?.fid === f.face_id
                return (
                  <SampleFaceCell
                    key={f.face_id}
                    faceId={f.face_id}
                    isCurrentThumb={isCurrentThumb}
                    isSetting={isSetting}
                    isPending={setThumbnail.isPending}
                    onSetThumb={() => setThumbnail.mutate({ pid: personId, fid: f.face_id })}
                    onDelete={() => handleRemoveFace(f.face_id)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <button
          onClick={() => openMergeModal(person.id)}
          style={{ width: '100%', padding: 9, borderRadius: 8, background: '#242429', border: '1px solid #2e2e36', color: '#888', fontSize: 13, cursor: 'pointer' }}
        >
          Merge with another person…
        </button>
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', minHeight: 0 }}>

        {/* Media type filter + sort order */}
        {!timelineLoading && (photoCount > 0 || videoCount > 0) && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center' }}>
            {([
              { id: 'all',   label: 'All',      count: photoCount + videoCount },
              { id: 'photo', label: '🖼 Photos', count: photoCount },
              { id: 'video', label: '▶ Videos', count: videoCount },
            ] as const).map(({ id, label, count }) => (
              <button
                key={id}
                onClick={() => setMediaFilter(id)}
                style={{
                  padding: '5px 13px', borderRadius: 20, fontSize: 13, cursor: 'pointer', border: 'none',
                  background: mediaFilter === id ? '#7c6af7' : '#242429',
                  color: mediaFilter === id ? '#fff' : '#888',
                  fontWeight: mediaFilter === id ? 600 : 400,
                }}
              >
                {label} <span style={{ opacity: 0.65, fontSize: 11 }}>{count}</span>
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setOrder(o => o === 'desc' ? 'asc' : 'desc')}
              title={order === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                background: '#242429', border: 'none', color: '#888', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {order === 'desc' ? '↓ Newest' : '↑ Oldest'}
            </button>
          </div>
        )}

        {timelineLoading ? (
          <div style={{ color: '#555', textAlign: 'center', paddingTop: 40 }}>Loading timeline…</div>
        ) : !timeline || timeline.length === 0 ? (
          <div style={{ color: '#555', textAlign: 'center', paddingTop: 40 }}>
            {mediaFilter !== 'all' ? `No ${mediaFilter}s found.` : 'No appearances found.'}
          </div>
        ) : (
          <>
            {timeline.map((group) => <TimelineSection key={group.label} group={group} playlist={allAppearances} labels={allLabels} onDelete={handleRemoveFace} />)}

            {isFetchingNextPage && (
              <div style={{ color: '#555', textAlign: 'center', padding: '16px' }}>Loading more…</div>
            )}

            {hasNextPage && !isFetchingNextPage && (
              <div style={{ textAlign: 'center', paddingBottom: 32 }}>
                <button
                  onClick={() => fetchNextPage()}
                  style={{
                    padding: '9px 24px', borderRadius: 8, background: '#1a1a1f',
                    border: '1px solid #2e2e36', color: '#888', fontSize: 14, cursor: 'pointer',
                  }}
                >
                  Load more appearances
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePersons, useMergePersons } from '../api/persons'
import { useUIStore } from '../store/ui'
import { FaceThumbnail } from './FaceThumbnail'

export function PersonMergeModal() {
  const { mergeModalOpen, mergeSourceId, closeMergeModal } = useUIStore()
  const { data: persons } = usePersons()
  const merge = useMergePersons()
  const navigate = useNavigate()
  const [targetId, setTargetId] = useState<number | null>(null)

  if (!mergeModalOpen || mergeSourceId == null) return null

  const candidates = (persons?.pages.flat() ?? []).filter((p) => p.id !== mergeSourceId)

  const handleMerge = async () => {
    if (!targetId) return
    await merge.mutateAsync({ sourceId: mergeSourceId, targetId })
    closeMergeModal()
    setTargetId(null)
    navigate(`/person/${targetId}`)
  }

  return (
    <div
      onClick={closeMergeModal}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a1f', border: '1px solid #2e2e36', borderRadius: 16,
          padding: 28, width: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>Merge into…</div>
        <div style={{ fontSize: 13, color: '#888' }}>
          Select the person to merge into. The source cluster will be deleted and its faces moved to the target.
        </div>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {candidates.map((p) => (
            <div
              key={p.id}
              onClick={() => setTargetId(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                borderRadius: 10, cursor: 'pointer',
                background: targetId === p.id ? '#2a2440' : '#242429',
                border: `2px solid ${targetId === p.id ? '#7c6af7' : 'transparent'}`,
              }}
            >
              {p.thumbnail_face_id && (
                <div style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                  <FaceThumbnail faceId={p.thumbnail_face_id} size={44} />
                </div>
              )}
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name ?? 'Unknown person'}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{p.appearance_count} appearances</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={closeMergeModal}
            style={{ padding: '8px 16px', background: '#242429', border: '1px solid #2e2e36', borderRadius: 8, color: '#888', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={!targetId || merge.isPending}
            style={{
              padding: '8px 16px', background: '#7c6af7', border: 'none', borderRadius: 8,
              color: '#fff', fontWeight: 600, cursor: targetId ? 'pointer' : 'not-allowed', opacity: targetId ? 1 : 0.5,
            }}
          >
            {merge.isPending ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}

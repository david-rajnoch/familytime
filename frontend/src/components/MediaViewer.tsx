/**
 * Full-screen media viewer with:
 * - Photo display
 * - Video playback with seeking to exact timestamp
 * - Bounding box overlay for the face
 */
import { useEffect, useRef, useCallback } from 'react'
import type {} from '../api/persons'
import { useUIStore } from '../store/ui'

function formatTimestamp(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}


export function MediaViewer() {
  const { open, appearance: a, playlist, playlistLabels, playlistIndex, closeViewer, navigateViewer } = useUIStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasPrev = playlistIndex > 0
  const hasNext = playlistIndex < playlist.length - 1

  // Seek video to the face timestamp when it loads
  const handleVideoLoaded = useCallback(() => {
    if (videoRef.current && a?.source_timestamp_ms != null) {
      videoRef.current.currentTime = a.source_timestamp_ms / 1000
    }
  }, [a?.source_timestamp_ms])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeViewer()
      if (e.key === 'ArrowLeft') navigateViewer(-1)
      if (e.key === 'ArrowRight') navigateViewer(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeViewer, navigateViewer])

  if (!open || !a) return null

  const isVideo = a.file_type === 'video'
  const fileName = a.file_path.split('/').pop() ?? a.file_path

  return (
    <div
      onClick={closeViewer}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: isVideo ? 'min(900px, 95vw)' : 'min(1200px, 95vw)', position: 'relative' }}
      >
        {/* Top bar: counter + close */}
        <div style={{ position: 'absolute', top: -40, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, color: '#555' }}>
            {playlist.length > 1 && `${playlistIndex + 1} / ${playlist.length}`}
          </div>
          <button
            onClick={closeViewer}
            style={{ background: 'none', border: 'none', color: '#888', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Prev arrow */}
        {hasPrev && (
          <button
            onClick={() => navigateViewer(-1)}
            style={{
              position: 'absolute', left: -52, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.08)', border: '1px solid #2e2e36',
              borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', color: '#e8e8f0', fontSize: 18,
              transition: 'background .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.16)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
          >
            ‹
          </button>
        )}

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={() => navigateViewer(1)}
            style={{
              position: 'absolute', right: -52, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.08)', border: '1px solid #2e2e36',
              borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', color: '#e8e8f0', fontSize: 18,
              transition: 'background .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.16)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
          >
            ›
          </button>
        )}

        {/* Group label */}
        {playlistLabels[playlistIndex] && (
          <div style={{
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 600,
            color: '#7c6af7',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            {playlistLabels[playlistIndex]}
          </div>
        )}

        {/* Media area */}
        <div
          style={{
            position: 'relative',
            borderRadius: 12,
            overflow: 'hidden',
            background: '#000',
            ...(isVideo ? { aspectRatio: '16/9' } : { maxHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }),
          }}
        >
          {isVideo ? (
            <video
              ref={videoRef}
              src={`/api/files/${a.file_id}/stream`}
              controls
              onLoadedMetadata={handleVideoLoaded}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <img
              src={`/api/files/${a.file_id}/photo`}
              alt=""
              style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', display: 'block' }}
            />
          )}

        </div>

        {/* Meta bar */}
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, fontSize: 13, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </div>
          {a.source_timestamp_ms != null && (
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e8f0', flexShrink: 0 }}>
              @ {formatTimestamp(a.source_timestamp_ms)}
            </div>
          )}
          {a.taken_at && (
            <div style={{ fontSize: 13, color: '#888', flexShrink: 0 }}>
              {new Date(a.taken_at).toLocaleDateString()}
            </div>
          )}
          <button
            onClick={() => window.open(isVideo ? `/api/files/${a.file_id}/stream` : `/api/files/${a.file_id}/photo`, '_blank')}
            style={{
              padding: '6px 12px',
              borderRadius: 7,
              background: '#1a1a1f',
              border: '1px solid #2e2e36',
              color: '#e8e8f0',
              fontSize: 13,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Open File
          </button>
        </div>
      </div>
    </div>
  )
}

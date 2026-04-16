/**
 * Full-screen media viewer with:
 * - Photo display
 * - Video playback with seeking to exact timestamp
 * - Presentation mode: photos auto-advance every 5s, videos autoplay then advance
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import type {} from '../api/persons'
import { useUIStore } from '../store/ui'

const PHOTO_DURATION_MS = 5000

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
  const [presenting, setPresenting] = useState(false)
  const [progress, setProgress] = useState(0) // 0–100 for the photo timer bar
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)

  const advance = useCallback(() => {
    if (playlistIndex < playlist.length - 1) {
      navigateViewer(1)
    } else {
      // End of playlist — stop presentation
      setPresenting(false)
    }
  }, [playlistIndex, playlist.length, navigateViewer])

  // Clear any running timers
  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [])

  // Start the 5s photo countdown with a smooth progress bar
  const startPhotoTimer = useCallback(() => {
    clearTimers()
    setProgress(0)
    startTimeRef.current = performance.now()

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current
      const pct = Math.min((elapsed / PHOTO_DURATION_MS) * 100, 100)
      setProgress(pct)
      if (pct < 100) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    timerRef.current = setTimeout(advance, PHOTO_DURATION_MS)
  }, [advance, clearTimers])

  // When presenting mode or current item changes, set up the right auto-advance
  useEffect(() => {
    if (!presenting || !a) { clearTimers(); setProgress(0); return }

    if (a.file_type === 'photo') {
      startPhotoTimer()
    }
    // Videos: handled by onEnded / onError on the <video> element

    return clearTimers
  }, [presenting, a?.face_id, a?.file_type]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stop presentation when viewer closes
  useEffect(() => {
    if (!open) { setPresenting(false); clearTimers() }
  }, [open, clearTimers])

  // Seek video to face timestamp on load; autoplay in presentation mode
  const handleVideoLoaded = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (a?.source_timestamp_ms != null) {
      v.currentTime = a.source_timestamp_ms / 1000
    }
    if (presenting) v.play().catch(() => {})
  }, [a?.source_timestamp_ms, presenting])

  // Video finished naturally → advance
  const handleVideoEnded = useCallback(() => {
    if (presenting) advance()
  }, [presenting, advance])

  // Media failed to load (drive offline etc.) → skip in presentation mode
  const handleError = useCallback(() => {
    if (presenting) {
      clearTimers()
      // Small delay so we don't spin instantly through many bad items
      timerRef.current = setTimeout(advance, 10)
    }
  }, [presenting, advance, clearTimers])

  // Keyboard navigation + P to toggle presentation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPresenting(false); closeViewer() }
      if (e.key === 'ArrowLeft') { setPresenting(false); navigateViewer(-1) }
      if (e.key === 'ArrowRight') { setPresenting(false); navigateViewer(1) }
      if (e.key === 'p' || e.key === 'P' || e.key === 'x' || e.key === 'X') setPresenting((v) => !v)
      if (e.key === 'Backspace' && videoRef.current) {
        e.preventDefault()
        videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeViewer, navigateViewer])

  if (!open || !a) return null

  const isVideo = a.file_type === 'video'
  const fileName = a.file_path.split('/').pop() ?? a.file_path

  return (
    <div
      onClick={closeViewer}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.96)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Media — full screen */}
      {isVideo ? (
        <video
          key={a.face_id}
          ref={videoRef}
          src={`/api/files/${a.file_id}/stream`}
          controls={!presenting}
          autoPlay={presenting}
          onClick={(e) => e.stopPropagation()}
          onLoadedMetadata={handleVideoLoaded}
          onEnded={handleVideoEnded}
          onError={handleError}
          style={{ width: '100vw', height: '100vh', objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <img
          key={a.face_id}
          src={`/api/files/${a.file_id}/photo`}
          alt=""
          onClick={(e) => e.stopPropagation()}
          onError={handleError}
          style={{ maxWidth: '100vw', maxHeight: '100vh', objectFit: 'contain', display: 'block' }}
        />
      )}

      {/* Photo countdown bar */}
      {presenting && !isVideo && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.15)', zIndex: 201 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: '#7c6af7', transition: 'none' }} />
        </div>
      )}

      {/* Close — top right */}
      <button
        onClick={closeViewer}
        style={{
          position: 'fixed', top: 16, right: 16,
          background: 'rgba(0,0,0,0.5)', border: 'none',
          color: '#fff', fontSize: 22, cursor: 'pointer',
          width: 40, height: 40, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      {/* Presentation toggle — top right, left of close */}
      <button
        onClick={(e) => { e.stopPropagation(); setPresenting((v) => !v) }}
        title={presenting ? 'Stop presentation (X)' : 'Start presentation (X)'}
        style={{
          position: 'fixed', top: 16, right: 68,
          background: presenting ? 'rgba(124,106,247,0.7)' : 'rgba(0,0,0,0.5)', border: 'none',
          color: '#fff', fontSize: 16, cursor: 'pointer',
          width: 40, height: 40, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >{presenting ? '⏸' : '▶'}</button>

      {/* Counter — top left */}
      {playlist.length > 1 && (
        <div style={{
          position: 'fixed', top: 20, left: 20,
          fontSize: 13, color: 'rgba(255,255,255,0.5)',
          pointerEvents: 'none',
        }}>
          {playlistIndex + 1} / {playlist.length}
        </div>
      )}

      {/* Prev arrow — hidden in presentation mode */}
      {hasPrev && !presenting && (
        <button
          onClick={(e) => { e.stopPropagation(); navigateViewer(-1) }}
          style={{
            position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.4)', border: 'none',
            borderRadius: '50%', width: 48, height: 48, display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', color: '#fff', fontSize: 24,
          }}
        >‹</button>
      )}

      {/* Next arrow — hidden in presentation mode */}
      {hasNext && !presenting && (
        <button
          onClick={(e) => { e.stopPropagation(); navigateViewer(1) }}
          style={{
            position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(0,0,0,0.4)', border: 'none',
            borderRadius: '50%', width: 48, height: 48, display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', color: '#fff', fontSize: 24,
          }}
        >›</button>
      )}

      {/* Meta bar — bottom overlay */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
          padding: '24px 20px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          pointerEvents: 'none',
        }}
      >
        <div style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {playlistLabels[playlistIndex] && <span style={{ color: '#7c6af7', marginRight: 8 }}>{playlistLabels[playlistIndex]}</span>}
          {fileName}
        </div>
        {a.source_timestamp_ms != null && (
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
            @ {formatTimestamp(a.source_timestamp_ms)}
          </div>
        )}
        {a.taken_at && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>
            {new Date(a.taken_at).toLocaleDateString()}
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); window.open(isVideo ? `/api/files/${a.file_id}/stream` : `/api/files/${a.file_id}/photo`, '_blank') }}
          style={{
            padding: '6px 12px', borderRadius: 7,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', fontSize: 13, cursor: 'pointer', flexShrink: 0, pointerEvents: 'all',
          }}
        >
          Open File
        </button>
      </div>
    </div>
  )
}

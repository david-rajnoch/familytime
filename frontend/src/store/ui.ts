import { create } from 'zustand'
import type { Appearance } from '../api/persons'

interface ViewerState {
  open: boolean
  appearance: Appearance | null
  playlist: Appearance[]
  playlistLabels: string[]
  playlistIndex: number
  openViewer: (a: Appearance, playlist?: Appearance[], labels?: string[]) => void
  closeViewer: () => void
  navigateViewer: (delta: 1 | -1) => void
}

interface UIState extends ViewerState {
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  mergeModalOpen: boolean
  mergeSourceId: number | null
  openMergeModal: (sourceId: number) => void
  closeMergeModal: () => void
}

export const useUIStore = create<UIState>((set) => ({
  // Viewer
  open: false,
  appearance: null,
  playlist: [],
  playlistLabels: [],
  playlistIndex: 0,
  openViewer: (a, playlist, labels) => {
    const list = playlist ?? [a]
    const idx = playlist ? playlist.findIndex((x) => x.face_id === a.face_id) : 0
    set({ open: true, appearance: a, playlist: list, playlistLabels: labels ?? [], playlistIndex: Math.max(0, idx) })
  },
  closeViewer: () => set({ open: false, appearance: null, playlist: [], playlistLabels: [], playlistIndex: 0 }),
  navigateViewer: (delta) =>
    set((s) => {
      if (!s.playlist.length) return {}
      const next = s.playlistIndex + delta
      if (next < 0 || next >= s.playlist.length) return {}
      return { playlistIndex: next, appearance: s.playlist[next] }
    }),

  // Indexing drawer
  drawerOpen: false,
  setDrawerOpen: (open) => set({ drawerOpen: open }),

  // Merge modal
  mergeModalOpen: false,
  mergeSourceId: null,
  openMergeModal: (sourceId) => set({ mergeModalOpen: true, mergeSourceId: sourceId }),
  closeMergeModal: () => set({ mergeModalOpen: false, mergeSourceId: null }),
}))

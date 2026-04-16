import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface IndexJob {
  id: number
  status: 'running' | 'clustering' | 'done' | 'error' | 'cancelled'
  root_path: string
  files_total: number
  files_done: number
  faces_found: number
  error_msg: string | null
  started_at: string | null
  finished_at: string | null
}

export interface StartIndexRequest {
  path: string
  video_sample_interval_s?: number
  scene_detection?: boolean
}

export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => apiFetch<IndexJob[]>('/index/jobs'),
    refetchInterval: 3000,
  })
}

export function useStartIndex() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: StartIndexRequest) =>
      apiFetch<IndexJob>('/index/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useCancelJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: number) =>
      apiFetch(`/index/jobs/${jobId}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export interface IndexedFolder {
  label: string
  file_count: number
  face_count: number
  photo_count: number
  video_count: number
  first_date: string | null
  last_date: string | null
  sample_path: string | null
}

export function useFolders() {
  return useQuery({
    queryKey: ['folders'],
    queryFn: () => apiFetch<IndexedFolder[]>('/index/folders'),
  })
}

export function useDeleteFolders() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (labels: string[]) =>
      apiFetch('/index/folders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders'] })
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['timeline'] })
    },
  })
}

export function useTriggerClustering() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch('/index/cluster', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persons'] }),
  })
}

export function useExtractDates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<IndexJob>('/index/extract-dates', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

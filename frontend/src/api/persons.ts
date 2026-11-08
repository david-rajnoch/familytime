import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface Person {
  id: number
  name: string | null
  appearance_count: number
  date_first_seen: string | null
  date_last_seen: string | null
  thumbnail_face_id: number | null
  notes: string | null
}

export interface Appearance {
  face_id: number
  file_id: number
  file_path: string
  file_type: 'photo' | 'video'
  taken_at: string | null
  folder_label: string | null
  source_timestamp_ms: number | null
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  detection_conf: number
}

export interface TimelineGroup {
  label: string
  date: string | null
  appearances: Appearance[]
  total_count: number
}

const PERSONS_PAGE_SIZE = 60

export function usePersons(namedOnly = false) {
  return useInfiniteQuery({
    queryKey: ['persons', namedOnly],
    queryFn: ({ pageParam = 0 }) =>
      apiFetch<Person[]>(
        `/persons?named_only=${namedOnly}&limit=${PERSONS_PAGE_SIZE}&offset=${pageParam}`
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PERSONS_PAGE_SIZE
        ? allPages.length * PERSONS_PAGE_SIZE
        : undefined,
  })
}

export function usePerson(id: number) {
  return useQuery({
    queryKey: ['person', id],
    queryFn: () => apiFetch<Person>(`/persons/${id}`),
    enabled: id > 0,
  })
}

const TIMELINE_PAGE_SIZE = 20 // groups per page

export function useTimeline(personId: number, order: 'asc' | 'desc' = 'desc') {
  return useInfiniteQuery({
    queryKey: ['timeline', personId, order],
    queryFn: ({ pageParam = 0 }) =>
      apiFetch<TimelineGroup[]>(
        `/persons/${personId}/timeline?limit=${TIMELINE_PAGE_SIZE}&offset=${pageParam}&order=${order}`
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === TIMELINE_PAGE_SIZE
        ? allPages.length * TIMELINE_PAGE_SIZE
        : undefined,
    enabled: personId > 0,
  })
}

export function useSampleFaces(personId: number) {
  return useQuery({
    queryKey: ['sample-faces', personId],
    queryFn: () => apiFetch<Appearance[]>(`/persons/${personId}/faces`),
    enabled: personId > 0,
  })
}

const UNKNOWN_PAGE_SIZE = 100

export function useUnknownFaces() {
  return useInfiniteQuery({
    queryKey: ['unknown-faces'],
    queryFn: ({ pageParam = 0 }) =>
      apiFetch<Appearance[]>(`/persons/unknown?limit=${UNKNOWN_PAGE_SIZE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === UNKNOWN_PAGE_SIZE
        ? allPages.length * UNKNOWN_PAGE_SIZE
        : undefined,
  })
}

export function useSetThumbnail(personId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (faceId: number) =>
      apiFetch(`/persons/${personId}/thumbnail/${faceId}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['person', personId] })
    },
  })
}

export function useSetName(personId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/persons/${personId}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['person', personId] })
    },
  })
}

export function useMergePersons() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: number; targetId: number }) =>
      apiFetch('/persons/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persons'] }),
  })
}

export function useAssignFace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ personId, faceId }: { personId: number; faceId: number }) =>
      apiFetch(`/persons/${personId}/assign_face/${faceId}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['unknown-faces'] })
    },
  })
}

export function useRemoveFace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ personId, faceId }: { personId: number; faceId: number }) =>
      apiFetch(`/persons/${personId}/remove_face/${faceId}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persons'] }),
  })
}

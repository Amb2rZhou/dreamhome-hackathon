import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchPersistedVideoSelectionTasks,
  submitVideoSelection,
} from './videoSelectionApi'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('durable video selections', () => {
  it('sends the explicit user and client task ids with the untouched frame', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      select_id: 'sel-1',
      labels: {},
      candidates: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const frame = new Blob(['jpeg'], { type: 'image/jpeg' })

    await submitVideoSelection({
      videoId: 'home-1',
      time: 8.4,
      upload: {
        frame,
        frameWidth: 100,
        frameHeight: 80,
        bbox: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number],
        polygon: [[0.1, 0.2], [0.4, 0.2], [0.4, 0.6]] as Array<[number, number]>,
      },
      userId: 'local-profile-test',
      clientTaskId: 'craft-1',
    })

    const body = fetchMock.mock.calls[0][1]?.body as FormData
    expect(body.get('user_id')).toBe('local-profile-test')
    expect(body.get('client_task_id')).toBe('craft-1')
    const storedFrame = body.get('frame') as File
    expect(storedFrame).toBeInstanceOf(Blob)
    expect(storedFrame.type).toBe('image/jpeg')
    expect(storedFrame.size).toBe(frame.size)
  })

  it('loads only the current explicit user task list', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await fetchPersistedVideoSelectionTasks('local profile')

    expect(String(fetchMock.mock.calls[0][0])).toContain('user_id=local%20profile')
  })
})

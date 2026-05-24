import '@testing-library/jest-dom'

// Polyfill localStorage for Node 22+ where the native Web Storage API
// doesn't fully implement the browser Storage interface in jsdom.
const storage: Record<string, string> = {}
const storageMock = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, val: string) => { storage[key] = val },
  removeItem: (key: string) => { delete storage[key] },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]) },
  get length() { return Object.keys(storage).length },
  key: (i: number) => Object.keys(storage)[i] ?? null,
}
Object.defineProperty(globalThis, 'localStorage', { value: storageMock, writable: true })

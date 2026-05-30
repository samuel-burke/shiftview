import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock Supabase browser client so components that call createClient() in effects
// don't throw when NEXT_PUBLIC_ env vars are absent in the test environment.
const channelMock = {
  on: () => channelMock,
  subscribe: () => channelMock,
  unsubscribe: () => Promise.resolve(),
};
vi.mock("@/lib/supabase-browser", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      signInWithOtp: () => Promise.resolve({ error: null }),
      verifyOtp: () => Promise.resolve({ error: null }),
      signOut: () => Promise.resolve({ error: null }),
      exchangeCodeForSession: () => Promise.resolve({ error: null }),
      setSession: () => Promise.resolve({ error: null }),
    },
    channel: () => channelMock,
    removeChannel: () => {},
  }),
}));

// ResizeObserver is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// matchMedia is not available in jsdom — default to mobile (not desktop)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// The app's sample answers instead of Claude (localStorage avMockAI = "1", as without an API key), and a
// photo read through the real readInto with them. Needs mock.timers on setTimeout: the answers wait 900 ms.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readInto } from '../../app/js/ui/docs.js';
import { settle } from './fake-dom.mjs';
import '../../app/js/ai/mock.js'; // loaded before a read asks for it

// Turns the sample answers on; returns the function that puts localStorage back as it was.
export function useSampleAi() {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = { getItem: (key) => (key === 'avMockAI' ? '1' : null) };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  return () => {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  };
}

// The accident report's sample: driver A Uğurcan Kaya, driver B Ayşe Kara (35 KR 7781), her address unreadable.
export async function readSample(draft, kind) {
  const done = readInto(draft, kind, [new Blob(['x'], { type: 'image/jpeg' })]);
  for (let i = 0; i < 20 && draft.reads[kind].state === 'reading'; i++) {
    await settle();
    mock.timers.tick(1000);
  }
  await done;
  assert.equal(draft.reads[kind].state, 'done', draft.reads[kind].message);
}

import "@testing-library/jest-dom/vitest";

const randomUUID = () => `test-${Math.random().toString(16).slice(2)}`;

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: { randomUUID },
    configurable: true
  });
} else if (!globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: randomUUID,
    configurable: true
  });
}

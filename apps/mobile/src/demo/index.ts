// Demo mode in one import: fixtures (pure data), bundled images, and the in-memory demo state.
// The demo session itself (src/demo/session.ts) belongs to the auth feature.

export * from './fixtures';
export { demoCover, demoPanelImage } from './images';
export { demoDelay, demoState, DEMO_LATENCY_MS, resetDemoState, type DemoCell } from './state';

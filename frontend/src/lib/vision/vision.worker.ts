/// <reference lib="webworker" />
/**
 * Web Worker running MediaPipe inference off the main thread.
 * Receives transferred ImageBitmaps, returns coarse FrameObservations only, and closes every bitmap.
 *
 * Works as a CLASSIC worker (production: Next 16 Turbopack bundles `new Worker(new URL(...))` into a
 * bootstrap that loads its chunks with importScripts, which is illegal in module workers) and as a
 * MODULE worker (ESM bundlers). The mode decides which MediaPipe WASM loader can be used.
 */
import * as tasks from '@mediapipe/tasks-vision';
import { MediaPipeRunner } from './mediapipeRunner';
import type { FromWorker, ToWorker } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope & {
  import?: (url: string) => Promise<unknown>;
  ModuleFactory?: unknown;
};

/**
 * importScripts() with no arguments is a no-op in a classic worker and throws TypeError in a module
 * worker. Classic → tasks-vision loads `vision_wasm_internal.js` via importScripts (re-executed per
 * task, defines a global ModuleFactory). Module → it must use the ES-module loader (`useModule`).
 */
function detectModuleWorker(): boolean {
  try {
    scope.importScripts();
    return false;
  } catch {
    return true;
  }
}
const isModuleWorker = detectModuleWorker();

// tasks-vision falls back to `self.import(url)` when importScripts throws (module worker). Provide a
// native dynamic import the bundler leaves untouched, so the WASM loader is fetched at runtime from
// /mediapipe/wasm instead of being resolved at build time.
// After creating each task the bundle resets `self.ModuleFactory = undefined`; a second import() of
// the same URL hits the ES module cache and does not re-run the script, so the 2nd/3rd model would
// fail with "ModuleFactory not set." (observed in Chromium). Restore it from the default export.
const loaderModules = new Map<string, { default?: unknown }>();
scope.import = async (url: string) => {
  let mod = loaderModules.get(url);
  if (!mod) {
    mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url)) as { default?: unknown };
    loaderModules.set(url, mod);
  }
  if (typeof mod.default === 'function') scope.ModuleFactory = mod.default;
  return mod;
};

let runner: MediaPipeRunner | null = null;
let loading: Promise<void> | null = null;

const post = (msg: FromWorker) => scope.postMessage(msg);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

scope.addEventListener('message', (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'load':
      if (!loading) {
        loading = MediaPipeRunner.create(tasks, msg.settings, isModuleWorker).then((r) => {
          runner = r;
        });
      }
      loading.then(
        () => post({ type: 'loaded' }),
        (e) => {
          loading = null;
          post({ type: 'loadError', message: errMsg(e) });
        },
      );
      break;
    case 'analyze':
      try {
        if (!runner) throw new Error('models not loaded');
        post({ type: 'result', id: msg.id, observation: runner.analyze(msg.bitmap, msg.at, msg.runPhone) });
      } catch (e) {
        post({ type: 'analyzeError', id: msg.id, message: errMsg(e) });
      } finally {
        msg.bitmap.close();
      }
      break;
    case 'dispose':
      runner?.close();
      runner = null;
      scope.close();
      break;
  }
});

// Handshake: lets the main thread detect a worker that cannot start within a few seconds.
post({ type: 'ready', moduleWorker: isModuleWorker });

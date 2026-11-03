/// <reference lib="webworker" />
/**
 * Module Web Worker running MediaPipe inference off the main thread.
 * Receives transferred ImageBitmaps, returns coarse FrameObservations only, and closes every bitmap.
 */
import * as tasks from '@mediapipe/tasks-vision';
import { MediaPipeRunner } from './mediapipeRunner';
import type { FromWorker, ToWorker } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope & { import?: (url: string) => Promise<unknown> };

// tasks-vision falls back to `self.import(url)` when importScripts throws (module worker). Provide a
// native dynamic import the bundler leaves untouched, so the WASM loader is fetched at runtime from
// /mediapipe/wasm instead of being resolved at build time.
scope.import = (url: string) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url);

let runner: MediaPipeRunner | null = null;
let loading: Promise<void> | null = null;

const post = (msg: FromWorker) => scope.postMessage(msg);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

scope.addEventListener('message', (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'load':
      if (!loading) {
        loading = MediaPipeRunner.create(tasks, msg.settings, true).then((r) => {
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

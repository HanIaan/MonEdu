/**
 * @slow Long-run stability: CPU-time share and JS heap trend while monitoring.
 * Duration via SOAK_MINUTES (default 5). Writes test-results/soak-metrics.json.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { endStudy, installCanvasCamera, startStudy, uiLogin, USERS } from './helpers';

test('@slow soak: heap does not grow unboundedly and CPU share is recorded', async ({ browser }) => {
  const minutes = Number(process.env.SOAK_MINUTES ?? 5);
  test.setTimeout((minutes + 3) * 60_000);
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student2);
  await startStudy(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x: { name: string; value: number }) => [x.name, x.value]));
    return { t: Date.now(), heapMB: m.JSHeapUsedSize / 1e6, taskSec: m.TaskDuration, scriptSec: m.ScriptDuration, nodes: m.Nodes, listeners: m.JSEventListeners };
  };
  const samples = [await sample()];
  for (let i = 0; i < minutes * 2; i++) {
    await page.waitForTimeout(30_000);
    samples.push(await sample());
  }
  const first = samples[1] ?? samples[0]!;
  const last = samples.at(-1)!;
  const cpuShare = (last.taskSec - first.taskSec) / ((last.t - first.t) / 1000);
  const result = { minutes, cpuShareOfOneCore: cpuShare, heapStartMB: first.heapMB, heapEndMB: last.heapMB, samples };
  mkdirSync(join(import.meta.dirname, '..', 'test-results'), { recursive: true });
  writeFileSync(join(import.meta.dirname, '..', 'test-results', 'soak-metrics.json'), JSON.stringify(result, null, 2));
  console.log(`[soak] ${minutes} min · main-thread CPU ≈ ${(cpuShare * 100).toFixed(1)}% of one core · heap ${first.heapMB.toFixed(1)} → ${last.heapMB.toFixed(1)} MB · listeners ${first.listeners} → ${last.listeners}`);
  expect(last.heapMB - first.heapMB, 'heap growth after warm-up').toBeLessThan(30);
  expect(last.listeners - first.listeners, 'event listener leak').toBeLessThan(50);
  await endStudy(page);
  await ctx.close();
});

import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const API = process.env.E2E_API_URL ?? 'http://localhost:8080';
export const PASSWORD = 'demo1234!';
export const USERS = {
  teacher: 'teacher@demo.local',
  teacher2: 'teacher2@demo.local',
  student1: 'student1@demo.local',
  student2: 'student2@demo.local',
  student3: 'student3@demo.local',
} as const;

export async function apiLogin(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/api/v1/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  return { token: body.accessToken as string, user: body.user as { id: string; role: string; displayName: string } };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export function transition(seq: number, state: string, reason: string, detectedAt = new Date()) {
  return { eventId: randomUUID(), seq, state, reason, detectedAt: detectedAt.toISOString(), confidence: 0.9, signals: { cameraActive: true, pageVisible: true } };
}

export function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export async function uiLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
}

/**
 * Canvas-backed fake camera. Replaces getUserMedia with canvas.captureStream() so a test can switch
 * scenes at runtime: window.__fakeCam.setScene('person' | 'nobody' | 'black'), window.__fakeCam.stopTrack().
 * Images are real photos (fixtures/README.md); inference still runs the real MediaPipe models.
 */
export async function installCanvasCamera(context: BrowserContext, initial: 'person' | 'nobody' = 'person') {
  const dir = join(import.meta.dirname, '..', 'fixtures');
  const img = (n: string) => `data:image/jpeg;base64,${readFileSync(join(dir, `${n}.jpg`)).toString('base64')}`;
  await context.addInitScript(
    ({ person, nobody, initial }) => {
      const images: Record<string, HTMLImageElement> = {};
      let scene: string = initial;
      let tracks: MediaStreamTrack[] = [];
      const load = (k: string, src: string) => {
        const i = new Image();
        i.src = src;
        images[k] = i;
      };
      load('person', person);
      load('nobody', nobody);
      (window as unknown as Record<string, unknown>).__fakeCam = {
        setScene: (s: string) => {
          scene = s;
        },
        stopTrack: () => {
          for (const t of tracks) {
            t.stop();
            t.dispatchEvent(new Event('ended'));
          }
        },
      };
      const md = navigator.mediaDevices;
      if (!md) return;
      md.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d')!;
        const draw = () => {
          const im = images[scene];
          if (scene === 'black' || !im || !im.complete) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, 640, 480);
          } else {
            ctx.drawImage(im, 0, 0, 640, 480);
          }
          // tiny moving pixel so frames are never byte-identical
          ctx.fillStyle = `rgb(${Date.now() % 255},0,0)`;
          ctx.fillRect(0, 0, 1, 1);
        };
        draw();
        setInterval(draw, 66);
        const stream = canvas.captureStream(15);
        tracks = stream.getVideoTracks();
        return stream;
      };
    },
    { person: img('person'), nobody: img('nobody'), initial },
  );
}

export async function startStudy(page: Page) {
  await page.goto('/student');
  await page.getByTestId('privacy-consent').check();
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('camera-status')).toHaveAttribute('data-status', 'active', { timeout: 30_000 });
  await expect(page.getByTestId('model-status')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
}

export async function endStudy(page: Page) {
  await page.getByTestId('end-session').click();
  const confirm = page.getByTestId('confirm-end');
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

export const state = (page: Page) => page.getByTestId('current-state');

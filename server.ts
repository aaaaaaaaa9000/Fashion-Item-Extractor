import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { installLogin } from './login';
import { analyzePrompt, extractPrompt, upscalePrompt } from './prompts';
import type { AspectRatio, Background, ItemKind, Presentation, Quality } from './types';

// ---- Config (all from env) ----
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image';
// Used for the "high quality" option (the lite model only makes ~1K images).
const HQ_IMAGE_MODEL = process.env.GEMINI_HQ_IMAGE_MODEL || 'gemini-3.1-flash-image';
const APP_USERNAME = process.env.APP_USERNAME || 'user';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 30;
const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB) || 12;
const MAX_IMAGE_BASE64 = Math.ceil((MAX_IMAGE_MB * 1024 * 1024 * 4) / 3);
const MAX_DESCRIPTION_CHARS = Number(process.env.MAX_DESCRIPTION_CHARS) || 3000;
const MAX_NAME_CHARS = 120;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const ALLOWED_KIND = new Set<ItemKind>(['clothing', 'footwear', 'bag', 'accessory', 'jewelry']);
const ALLOWED_BACKGROUND = new Set<Background>(['white', 'gray', 'beige']);
const ALLOWED_PRESENTATION = new Set<Presentation>(['ghost', 'flat']);
const ALLOWED_ASPECT = new Set<AspectRatio>(['1:1', '4:5', '3:4']);
const ALLOWED_QUALITY = new Set<Quality>(['standard', '2K']);

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
];

// ---- Gemini client (created once, lazily) ----
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw Object.assign(new Error('GEMINI_API_KEY is not set'), { status: 'NO_KEY' });
  }
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return aiClient;
}

// ---- Helpers ----
type ImageInput = { base64: string; mimeType: string };

/** Returns an Arabic error message if the image is invalid, otherwise null. */
function validateImage(img: unknown): string | null {
  const i = img as Partial<ImageInput> | undefined;
  if (!i || typeof i.base64 !== 'string' || !i.base64) return 'ارفع صورة الموديل الأول.';
  if (typeof i.mimeType !== 'string' || !ALLOWED_MIME.has(i.mimeType)) {
    return 'نوع الصورة غير مدعوم. استخدم صورة عادية (جي بي جي أو بي إن جي).';
  }
  if (i.base64.length > MAX_IMAGE_BASE64) return `الصورة كبيرة جدًا. الحد الأقصى ${MAX_IMAGE_MB} ميجا.`;
  return null;
}

/** Maps a Gemini SDK error to an HTTP status and an Arabic message; logs details server-side. */
function sendGeminiError(res: Response, error: any, context: string) {
  console.error(`[${context}]`, error?.status, error?.message);
  const msg = String(error?.message || '');
  if (error?.status === 'NO_KEY') {
    return res.status(500).json({ error: 'مفتاح جيميناي مش متضبط على السيرفر.' });
  }
  if (error?.status === 429 || /429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return res.status(429).json({ error: 'تم تجاوز حد الاستخدام للمفتاح. جرّب تاني بعد شوية.' });
  }
  if (error?.status === 403 || /PERMISSION_DENIED|API_KEY_INVALID|API key/i.test(msg)) {
    return res.status(502).json({ error: 'مفتاح جيميناي مرفوض. راجع المفتاح في إعدادات السيرفر.' });
  }
  return res.status(500).json({ error: 'حصلت مشكلة أثناء المعالجة. جرّب تاني.' });
}

type GeneratedImage = { base64: string; mimeType: string };

/** Calls an image model and returns the first image, or an HTTP status + Arabic error. */
async function generateImage(
  model: string,
  parts: any[],
  imageConfig: Record<string, string>,
): Promise<GeneratedImage | { status: number; error: string }> {
  const response = await getAI().models.generateContent({
    model,
    contents: { parts },
    config: { safetySettings: SAFETY_SETTINGS as any, imageConfig },
  });
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) {
      return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
    }
  }
  const reason = response.candidates?.[0]?.finishReason;
  console.warn(`[extract] ${model} returned no image, finishReason:`, reason);
  if (reason && reason !== 'STOP') {
    return { status: 422, error: 'الموديل رفض يطلّع القطعة دي. جرّب تاني أو غيّر الوصف.' };
  }
  return { status: 502, error: 'الموديل ماطلّعش صورة. جرّب تاني.' };
}

// ---- Rate limit (per IP, fixed 1-minute window, in memory) ----
const hits = new Map<string, { count: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of hits) if (h.reset <= now) hits.delete(ip);
}, 60_000).unref();

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || h.reset <= now) {
    h = { count: 0, reset: now + 60_000 };
    hits.set(ip, h);
  }
  h.count++;
  if (h.count > RATE_LIMIT_PER_MINUTE) {
    res.setHeader('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
    return res.status(429).json({ error: 'طلبات كتير في وقت قصير. استنى دقيقة وجرّب تاني.' });
  }
  next();
}

const ANALYZE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name_ar: { type: Type.STRING },
          kind: { type: Type.STRING, enum: [...ALLOWED_KIND] },
          description: { type: Type.STRING },
        },
        required: ['name_ar', 'kind', 'description'],
      },
    },
  },
  required: ['items'],
};

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Health check (before auth so Docker/Traefik can reach it)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // In-page login form + session cookie (only when APP_PASSWORD is set)
  installLogin(app, { appName: 'مستخرج قطع الموضة', username: APP_USERNAME, password: APP_PASSWORD, accent: '#9C3548' });

  app.use(express.json({ limit: `${MAX_IMAGE_MB * 1.4 + 1}mb` }));

  // Step 1: find the pieces the model is wearing.
  app.post('/api/analyze', rateLimit, async (req, res) => {
    const { image } = req.body || {};
    const imageError = validateImage(image);
    if (imageError) return res.status(400).json({ error: imageError });

    try {
      const response = await getAI().models.generateContent({
        model: TEXT_MODEL,
        contents: {
          parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: analyzePrompt() }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: ANALYZE_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          safetySettings: SAFETY_SETTINGS as any,
        },
      });

      let items: any[] = [];
      try {
        items = JSON.parse(response.text || '{}').items || [];
      } catch {
        console.warn('[analyze] bad JSON, finishReason:', response.candidates?.[0]?.finishReason);
      }
      const clean = items
        .filter((i) => i && typeof i.name_ar === 'string' && typeof i.description === 'string')
        .slice(0, 15)
        .map((i) => ({
          name: i.name_ar.trim().slice(0, MAX_NAME_CHARS),
          kind: ALLOWED_KIND.has(i.kind) ? i.kind : 'clothing',
          description: i.description.trim().slice(0, MAX_DESCRIPTION_CHARS),
        }));
      if (clean.length === 0) {
        return res.status(422).json({ error: 'مالقيتش قطع لبس واضحة في الصورة. جرّب صورة أوضح للموديل كله.' });
      }
      return res.json({ items: clean });
    } catch (error) {
      return sendGeminiError(res, error, 'analyze');
    }
  });

  // Step 2: one product photo per selected piece.
  app.post('/api/extract', rateLimit, async (req, res) => {
    const { image, item, background, presentation, aspectRatio, quality } = req.body || {};
    const imageError = validateImage(image);
    if (imageError) return res.status(400).json({ error: imageError });

    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const description = typeof item?.description === 'string' ? item.description.trim() : '';
    if (!name && !description) return res.status(400).json({ error: 'اختار القطعة الأول.' });
    if (name.length > MAX_NAME_CHARS || description.length > MAX_DESCRIPTION_CHARS) {
      return res.status(413).json({ error: `وصف القطعة طويل جدًا. الحد الأقصى ${MAX_DESCRIPTION_CHARS} حرف.` });
    }
    const kind: ItemKind = ALLOWED_KIND.has(item?.kind) ? item.kind : 'clothing';
    if (
      !ALLOWED_BACKGROUND.has(background) ||
      !ALLOWED_PRESENTATION.has(presentation) ||
      !ALLOWED_ASPECT.has(aspectRatio) ||
      !ALLOWED_QUALITY.has(quality)
    ) {
      return res.status(400).json({ error: 'اختيارات الصورة مش صحيحة. حدّث الصفحة وجرّب تاني.' });
    }

    try {
      // The lite model follows "product photo only" well. The bigger models tend to edit the
      // reference photo instead (room, floor and other clothes leak in), so for high quality we
      // first make the clean product photo with the lite model and then re-render it at 2K.
      const base = await generateImage(
        IMAGE_MODEL,
        [
          { inlineData: { data: image.base64, mimeType: image.mimeType } },
          { text: extractPrompt({ name, description, kind, background, presentation }) },
        ],
        { aspectRatio },
      );
      if ('error' in base) return res.status(base.status).json({ error: base.error });
      if (quality === 'standard') return res.json(base);

      try {
        const hq = await generateImage(
          HQ_IMAGE_MODEL,
          [{ inlineData: { data: base.base64, mimeType: base.mimeType } }, { text: upscalePrompt() }],
          { aspectRatio, imageSize: quality },
        );
        if (!('error' in hq)) return res.json(hq);
        console.warn('[extract] high-quality pass failed, sending the standard image');
      } catch (error: any) {
        console.warn('[extract] high-quality pass failed, sending the standard image:', error?.status, error?.message);
      }
      return res.json({ ...base, lowered: true });
    } catch (error) {
      return sendGeminiError(res, error, 'extract');
    }
  });

  // Unknown API routes → JSON 404 (instead of the SPA page)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (IS_PROD) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use('/assets', express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(distPath, { index: false }));
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Server on :${PORT} | text model: ${TEXT_MODEL} | image model: ${IMAGE_MODEL} | HQ image model: ${HQ_IMAGE_MODEL} | ` +
        `auth: ${APP_PASSWORD ? 'on' : 'off'} | rate limit: ${RATE_LIMIT_PER_MINUTE}/min | ` +
        `key: ${process.env.GEMINI_API_KEY ? 'set' : 'MISSING'}`,
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

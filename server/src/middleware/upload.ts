import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env';
import { ApiError } from '../utils/http';

/** Extensions we can actually read text out of. */
export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.tsv', '.txt', '.md', '.json'] as const;

const ALLOWED_MIME = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/tsv',
  'application/csv',
  'application/json',
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  '',
]);

if (!fs.existsSync(env.uploadDir)) {
  fs.mkdirSync(env.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    // Never trust the client filename on disk: random name, validated extension.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    console.log(`[upload] received "${file.originalname}" ext=${ext} type=${file.mimetype || '(none)'}`);

    if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
      cb(ApiError.unsupportedMedia(`${ext || 'That file type'} is not supported. Use ${ALLOWED_EXTENSIONS.join(', ')}.`));
      return;
    }
    if (file.mimetype && !ALLOWED_MIME.has(file.mimetype)) {
      // Log rather than reject: the extension allowlist above already decided.
      // Browsers report inconsistent MIME types for plain-text formats.
      console.warn(`[upload] unusual content type "${file.mimetype}" for ${ext} - allowing`);
    }
    // Reject traversal attempts in the declared name.
    if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
      cb(ApiError.badRequest('Invalid file name'));
      return;
    }
    cb(null, true);
  },
});

/** Best-effort cleanup when a request fails after the file landed on disk. */
export function discardUpload(filePath?: string): void {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => undefined);
}

import crypto from 'node:crypto';

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_COST = 16384;
const PASSWORD_BLOCK_SIZE = 8;
const PASSWORD_PARALLELISM = 1;
const IDEMPOTENCY_SECRET_VERSION = 'v1';
const IDEMPOTENCY_SECRET_ALGORITHM = 'aes-256-gcm';
const IDEMPOTENCY_SECRET_IV_BYTES = 12;

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function createRawToken(): string {
  return `htl_${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashToken(value: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(value, 'utf8').digest('hex');
}

export function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_COST,
    r: PASSWORD_BLOCK_SIZE,
    p: PASSWORD_PARALLELISM,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$N=${PASSWORD_COST},r=${PASSWORD_BLOCK_SIZE},p=${PASSWORD_PARALLELISM}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') {
    return false;
  }
  const parameters = parts[1];
  const saltValue = parts[2];
  const hashValue = parts[3];
  if (parameters === undefined || saltValue === undefined || hashValue === undefined) {
    return false;
  }
  const values = new Map<string, string>();
  for (const entry of parameters.split(',')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      return false;
    }
    values.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  const cost = Number(values.get('N'));
  const blockSize = Number(values.get('r'));
  const parallelism = Number(values.get('p'));
  if (![cost, blockSize, parallelism].every(Number.isInteger) || !saltValue || !hashValue) {
    return false;
  }
  try {
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(saltValue, 'base64url'), expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: 64 * 1024 * 1024
    });
    return hashesMatch(actual.toString('hex'), expected.toString('hex'));
  } catch {
    return false;
  }
}

export function hashJson(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function createCsrfToken(): string {
  return `csrf_${crypto.randomBytes(24).toString('base64url')}`;
}

export function encryptIdempotencySecret(value: string, keyMaterial: string): string {
  const key = deriveIdempotencySecretKey(keyMaterial);
  const iv = crypto.randomBytes(IDEMPOTENCY_SECRET_IV_BYTES);
  const cipher = crypto.createCipheriv(IDEMPOTENCY_SECRET_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [IDEMPOTENCY_SECRET_VERSION, iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptIdempotencySecret(encoded: string, keyMaterial: string): string {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] = encoded.split('.');
  if (version !== IDEMPOTENCY_SECRET_VERSION || encodedIv === undefined || encodedAuthTag === undefined || encodedCiphertext === undefined) {
    throw new Error('The idempotency secret envelope is invalid.');
  }
  const decipher = crypto.createDecipheriv(
    IDEMPOTENCY_SECRET_ALGORITHM,
    deriveIdempotencySecretKey(keyMaterial),
    Buffer.from(encodedIv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(encodedAuthTag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString('utf8');
}

function deriveIdempotencySecretKey(keyMaterial: string): Buffer {
  return crypto.createHash('sha256').update('hotel-local/idempotency-secret/v1', 'utf8').update(keyMaterial, 'utf8').digest();
}

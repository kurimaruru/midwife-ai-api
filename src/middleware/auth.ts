import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import type { AppEnv } from '../types';
import { AppError, ErrorCode } from '../utils/errors';

// Apple Root CA - G3 (EC P-384) public key in PEM format.
// This is the root certificate used by Apple to sign StoreKit transactions.
// Source: https://www.apple.com/certificateauthority/
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN PUBLIC KEY-----
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEMMTJaFxbRIYMcCeMRNIjxigIPBfqHqBf
oPMK91sDiDOyENi1P/iFJBa3JqET0eQVGJaG+LFmlJnQzKdAEaPqz+bJi+FN6IE3
jTbCljYKPEpU+pjBRR5sFJx5Ej8Yvm5T
-----END PUBLIC KEY-----`;

/**
 * Parse a DER-encoded X.509 certificate to extract TBS, signature, and SPKI.
 * Minimal ASN.1 parser sufficient for Apple's StoreKit certificates.
 */
function parseDER(der: Uint8Array) {
  let offset = 0;

  function readTag(): number {
    return der[offset++];
  }

  function readLength(): number {
    const first = der[offset++];
    if (first < 0x80) return first;
    const numBytes = first & 0x7f;
    let length = 0;
    for (let i = 0; i < numBytes; i++) {
      length = (length << 8) | der[offset++];
    }
    return length;
  }

  function readTLV(): { tag: number; start: number; end: number; contentStart: number } {
    const start = offset;
    const tag = readTag();
    const length = readLength();
    const contentStart = offset;
    const end = offset + length;
    offset = end;
    return { tag, start, end, contentStart };
  }

  // Certificate SEQUENCE
  const certSeq = readTLV();
  offset = certSeq.contentStart;

  // TBSCertificate
  const tbsStart = offset;
  const tbs = readTLV();
  const tbsBytes = der.slice(tbsStart, tbs.end);

  // signatureAlgorithm
  const sigAlg = readTLV();
  const sigAlgOID = der.slice(sigAlg.contentStart, sigAlg.end);

  // signatureValue (BIT STRING)
  readTag(); // 0x03
  const sigLen = readLength();
  const unusedBits = der[offset++];
  const signatureValue = der.slice(offset, offset + sigLen - 1);

  // Now parse TBSCertificate to find subjectPublicKeyInfo
  offset = tbs.contentStart;

  // version [0] EXPLICIT
  if (der[offset] === 0xa0) {
    readTLV();
  }
  // serialNumber
  readTLV();
  // signature algorithm
  readTLV();
  // issuer
  readTLV();
  // validity
  readTLV();
  // subject
  readTLV();
  // subjectPublicKeyInfo
  const spkiStart = offset;
  const spki = readTLV();
  const spkiBytes = der.slice(spkiStart, spki.end);

  return { tbsBytes, signatureValue, spkiBytes, sigAlgOID };
}

/**
 * Determine EC curve params from SPKI key size.
 */
function getCurveFromSPKI(spkiBytes: Uint8Array): { name: string; hash: string } {
  // EC uncompressed point: 04 || x || y
  // P-256: 32-byte coordinates → 65 bytes total
  // P-384: 48-byte coordinates → 97 bytes total
  // The point is at the end of SPKI, check the full SPKI size
  if (spkiBytes.length > 80) {
    return { name: 'P-384', hash: 'SHA-384' };
  }
  return { name: 'P-256', hash: 'SHA-256' };
}

/**
 * Convert DER signature (r,s integers) to raw IEEE P1363 format expected by WebCrypto.
 */
function derSigToRaw(derSig: Uint8Array, curveSize: number): Uint8Array {
  let offset = 0;
  // SEQUENCE tag
  if (derSig[offset++] !== 0x30) throw new Error('Invalid DER signature');
  // length
  let len = derSig[offset++];
  if (len & 0x80) {
    const numBytes = len & 0x7f;
    offset += numBytes;
  }

  function readInteger(): Uint8Array {
    if (derSig[offset++] !== 0x02) throw new Error('Expected INTEGER');
    const intLen = derSig[offset++];
    const intBytes = derSig.slice(offset, offset + intLen);
    offset += intLen;
    return intBytes;
  }

  const r = readInteger();
  const s = readInteger();

  // Pad or trim to curveSize
  function toFixed(val: Uint8Array, size: number): Uint8Array {
    if (val.length === size) return val;
    if (val.length > size) {
      // Trim leading zeros
      return val.slice(val.length - size);
    }
    // Pad with leading zeros
    const padded = new Uint8Array(size);
    padded.set(val, size - val.length);
    return padded;
  }

  const raw = new Uint8Array(curveSize * 2);
  raw.set(toFixed(r, curveSize), 0);
  raw.set(toFixed(s, curveSize), curveSize);
  return raw;
}

/**
 * Verify a certificate was signed by the given issuer public key.
 */
async function verifyCertSignature(
  certDER: Uint8Array,
  issuerPublicKey: CryptoKey,
  issuerCurve: { name: string; hash: string },
): Promise<boolean> {
  const { tbsBytes, signatureValue } = parseDER(certDER);
  const curveSize = issuerCurve.name === 'P-384' ? 48 : 32;
  const rawSig = derSigToRaw(signatureValue, curveSize);

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: issuerCurve.hash },
    issuerPublicKey,
    rawSig,
    tbsBytes,
  );
}

/**
 * Import the Apple Root CA G3 public key.
 */
async function importAppleRootKey(): Promise<CryptoKey> {
  return jose.importSPKI(APPLE_ROOT_CA_G3_PEM, 'ES384');
}

/**
 * Verify the x5c certificate chain and return the leaf certificate's public key.
 */
async function verifyX5cChain(x5c: string[]): Promise<CryptoKey> {
  if (x5c.length < 2) {
    throw new AppError(ErrorCode.AUTH_INVALID, '証明書チェーンが不完全です。');
  }

  // Decode certificates from base64 DER
  const certs = x5c.map((cert) => {
    const binary = atob(cert);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  });

  // Verify chain: last cert → intermediate → ... → leaf
  // The root CA signs the last cert in the chain
  const rootKey = await importAppleRootKey();

  // Verify the last cert (closest to root) against Apple Root CA G3
  const lastCertValid = await verifyCertSignature(
    certs[certs.length - 1],
    rootKey,
    { name: 'P-384', hash: 'SHA-384' },
  );
  if (!lastCertValid) {
    throw new AppError(ErrorCode.AUTH_INVALID, 'ルート証明書の検証に失敗しました。');
  }

  // Verify each cert against its issuer (walking from root toward leaf)
  for (let i = certs.length - 1; i > 0; i--) {
    const issuerSPKI = parseDER(certs[i]).spkiBytes;
    const issuerCurve = getCurveFromSPKI(issuerSPKI);
    const issuerKey = await crypto.subtle.importKey(
      'spki',
      issuerSPKI,
      { name: 'ECDSA', namedCurve: issuerCurve.name },
      false,
      ['verify'],
    );

    const valid = await verifyCertSignature(certs[i - 1], issuerKey, issuerCurve);
    if (!valid) {
      throw new AppError(ErrorCode.AUTH_INVALID, '証明書チェーンの検証に失敗しました。');
    }
  }

  // Extract leaf certificate public key
  const leafSPKI = parseDER(certs[0]).spkiBytes;
  const leafCurve = getCurveFromSPKI(leafSPKI);
  return crypto.subtle.importKey(
    'spki',
    leafSPKI,
    { name: 'ECDSA', namedCurve: leafCurve.name },
    false,
    ['verify'],
  );
}

type StoreKitPayload = {
  bundleId: string;
  productId: string;
  expiresDate: number;
  originalTransactionId: string;
  environment: string;
};

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // 開発環境では認証をスキップ
  if (c.env.ENVIRONMENT === 'development') {
    c.set('transactionId', 'dev-user');
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(ErrorCode.AUTH_MISSING);
  }

  const token = authHeader.slice(7);

  try {
    // Decode the JWS protected header to extract x5c
    const protectedHeader = jose.decodeProtectedHeader(token);
    const x5c = protectedHeader.x5c;
    if (!x5c || x5c.length === 0) {
      throw new AppError(ErrorCode.AUTH_INVALID, 'x5c証明書チェーンが見つかりません。');
    }

    // Verify certificate chain and get leaf public key
    const leafKey = await verifyX5cChain(x5c);

    // Verify the JWS signature using the leaf certificate's public key
    const { payload } = await jose.compactVerify(token, leafKey);
    const decoded = JSON.parse(new TextDecoder().decode(payload)) as StoreKitPayload;

    // Validate payload fields
    const { ALLOWED_BUNDLE_ID, PREMIUM_PRODUCT_ID } = c.env;

    if (decoded.bundleId !== ALLOWED_BUNDLE_ID) {
      throw new AppError(ErrorCode.AUTH_INVALID, 'バンドルIDが一致しません。');
    }

    if (decoded.productId !== PREMIUM_PRODUCT_ID) {
      throw new AppError(ErrorCode.AUTH_INVALID, 'プロダクトIDが一致しません。');
    }

    // Check expiration (expiresDate is milliseconds since epoch)
    if (decoded.expiresDate < Date.now()) {
      throw new AppError(ErrorCode.SUBSCRIPTION_EXPIRED);
    }

    // Set transaction ID for downstream use
    c.set('transactionId', decoded.originalTransactionId);
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error('Auth verification failed:', e);
    throw new AppError(ErrorCode.AUTH_INVALID);
  }

  await next();
});

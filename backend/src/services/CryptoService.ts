import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // NIST SP 800-38D recommended length for GCM
const ENCRYPTED_PREFIX = 'enc:';

export class CryptoService {
    private static instance: CryptoService;
    private key: Buffer;

    private constructor() {
        const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
        const keyPath = path.join(dataDir, 'encryption.key');

        if (fs.existsSync(keyPath)) {
            this.key = Buffer.from(fs.readFileSync(keyPath, 'utf-8').trim(), 'hex');
        } else {
            this.key = crypto.randomBytes(KEY_LENGTH);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(keyPath, this.key.toString('hex'), { mode: 0o600 });
        }
    }

    public static getInstance(): CryptoService {
        if (!CryptoService.instance) {
            CryptoService.instance = new CryptoService();
        }
        return CryptoService.instance;
    }

    public encrypt(plaintext: string): string {
        if (!plaintext) return plaintext;

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    public decrypt(ciphertext: string): string {
        if (!ciphertext || !this.isEncrypted(ciphertext)) return ciphertext;

        const payload = ciphertext.slice(ENCRYPTED_PREFIX.length);
        const [ivHex, authTagHex, encryptedHex] = payload.split(':');

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
        decipher.setAuthTag(authTag);

        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
    }

    public isEncrypted(value: string): boolean {
        return value.startsWith(ENCRYPTED_PREFIX);
    }
}

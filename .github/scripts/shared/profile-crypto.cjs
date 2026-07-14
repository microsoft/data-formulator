'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('node:util');

const SCHEMA_VERSION = '1.0';
const ALGORITHM = 'aes-256-gcm';
const KDF = 'scrypt';
const PASSWORD_ENV = 'ALEX_ACT_MEMORY_PASSWORD';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const AAD = Buffer.from(`alex-act-memory-profile:${SCHEMA_VERSION}:${ALGORITHM}:${KDF}`);

class ProfileCryptoError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ProfileCryptoError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new ProfileCryptoError(code, message);
}

function readPassword(environment = process.env, variableName = PASSWORD_ENV) {
    const password = environment && environment[variableName];
    if (typeof password !== 'string' || password.length === 0) {
        fail('PROFILE_PASSWORD_MISSING', `Profile password is unavailable in ${variableName}`);
    }
    return password;
}

function readSecretFromSources(options = {}) {
    const environment = options.environment || process.env;
    const variableName = options.variableName || PASSWORD_ENV;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)) {
        fail('LOCAL_SECRET_NAME_INVALID', 'Local secret variable name is invalid');
    }
    if (typeof environment[variableName] === 'string' && environment[variableName].length > 0) {
        return environment[variableName];
    }

    const candidates = [];
    if (options.envFile) candidates.push(options.envFile);
    if (Array.isArray(options.envFiles)) candidates.push(...options.envFiles);
    const seen = new Set();
    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate.length === 0) continue;
        const envFile = path.resolve(candidate);
        const key = process.platform === 'win32' ? envFile.toLowerCase() : envFile;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!fs.existsSync(envFile)) continue;
        try {
            if (options.requireGitignored) {
                assertEnvFileGitignored(
                    envFile,
                    options.envNotIgnoredCode || 'LOCAL_SECRET_ENV_NOT_IGNORED'
                );
            }
            const parsed = parseEnv(fs.readFileSync(envFile, 'utf8'));
            if (typeof parsed[variableName] === 'string' && parsed[variableName].length > 0) {
                return parsed[variableName];
            }
        } catch (cause) {
            if (cause instanceof ProfileCryptoError) throw cause;
            fail(
                options.envInvalidCode || 'LOCAL_SECRET_ENV_INVALID',
                'Local secret environment file is invalid'
            );
        }
    }

    if (options.required) {
        fail(
            options.missingCode || 'LOCAL_SECRET_MISSING',
            `Local secret is unavailable in ${variableName}`
        );
    }
    return null;
}

function readPasswordFromSources(options = {}) {
    return readSecretFromSources({
        ...options,
        required: true,
        missingCode: 'PROFILE_PASSWORD_MISSING',
        envNotIgnoredCode: 'PROFILE_ENV_NOT_IGNORED',
        envInvalidCode: 'PROFILE_ENV_INVALID',
    });
}

function assertEnvFileGitignored(envFile, errorCode = 'PROFILE_ENV_NOT_IGNORED') {
    const absolute = path.resolve(envFile);
    const result = spawnSync(
        'git',
        ['check-ignore', '--quiet', '--no-index', path.basename(absolute)],
        { cwd: path.dirname(absolute), stdio: 'ignore' }
    );
    if (result.status !== 0) {
        fail(errorCode, 'Local secret environment file must be ignored by Git');
    }
}

function decodeBase64(value, expectedBytes, field) {
    if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        fail('PROFILE_ENVELOPE_INVALID', `Encrypted profile field is invalid: ${field}`);
    }
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value || (expectedBytes && bytes.length !== expectedBytes)) {
        fail('PROFILE_ENVELOPE_INVALID', `Encrypted profile field is invalid: ${field}`);
    }
    return bytes;
}

function parseEnvelope(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('PROFILE_ENVELOPE_INVALID', 'Encrypted profile envelope must be an object');
    }
    if (value.schema_version !== SCHEMA_VERSION) {
        fail('PROFILE_ENVELOPE_UNSUPPORTED', 'Encrypted profile schema version is unsupported');
    }
    const encryption = value.encryption;
    if (!encryption || typeof encryption !== 'object' || Array.isArray(encryption) ||
        encryption.algorithm !== ALGORITHM || encryption.kdf !== KDF) {
        fail('PROFILE_ENVELOPE_UNSUPPORTED', 'Encrypted profile algorithm or KDF is unsupported');
    }
    const salt = decodeBase64(encryption.salt, SALT_BYTES, 'salt');
    const iv = decodeBase64(encryption.iv, IV_BYTES, 'iv');
    const authTag = decodeBase64(encryption.auth_tag, AUTH_TAG_BYTES, 'auth_tag');
    const ciphertext = decodeBase64(value.ciphertext, null, 'ciphertext');
    return { salt, iv, authTag, ciphertext };
}

function deriveKey(password, salt) {
    try {
        return crypto.scryptSync(password, salt, KEY_BYTES, SCRYPT_OPTIONS);
    } catch {
        fail('PROFILE_KDF_FAILED', 'Profile key derivation failed');
    }
}

function encryptBuffer(plaintext, password) {
    if (!Buffer.isBuffer(plaintext)) {
        fail('PROFILE_PLAINTEXT_INVALID', 'Profile plaintext must be a Buffer');
    }
    if (typeof password !== 'string' || password.length === 0) {
        fail('PROFILE_PASSWORD_MISSING', `Profile password is unavailable in ${PASSWORD_ENV}`);
    }
    const salt = crypto.randomBytes(SALT_BYTES);
    const iv = crypto.randomBytes(IV_BYTES);
    const key = deriveKey(password, salt);
    try {
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
        cipher.setAAD(AAD);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return {
            schema_version: SCHEMA_VERSION,
            encryption: {
                algorithm: ALGORITHM,
                kdf: KDF,
                salt: salt.toString('base64'),
                iv: iv.toString('base64'),
                auth_tag: authTag.toString('base64'),
            },
            ciphertext: ciphertext.toString('base64'),
        };
    } finally {
        key.fill(0);
    }
}

function decryptEnvelope(envelope, password) {
    if (typeof password !== 'string' || password.length === 0) {
        fail('PROFILE_PASSWORD_MISSING', `Profile password is unavailable in ${PASSWORD_ENV}`);
    }
    const { salt, iv, authTag, ciphertext } = parseEnvelope(envelope);
    const key = deriveKey(password, salt);
    try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
        decipher.setAAD(AAD);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
        fail('PROFILE_AUTH_FAILED', 'Encrypted profile authentication failed');
    } finally {
        key.fill(0);
    }
}

function verifyEnvelope(envelope, password) {
    const plaintext = decryptEnvelope(envelope, password);
    plaintext.fill(0);
    return true;
}

function rotateEnvelope(envelope, oldPassword, newPassword) {
    const plaintext = decryptEnvelope(envelope, oldPassword);
    try {
        return encryptBuffer(plaintext, newPassword);
    } finally {
        plaintext.fill(0);
    }
}

function writeBufferAtomic(targetPath, value) {
    const absoluteTarget = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
    const temporary = path.join(
        path.dirname(absoluteTarget),
        `.${path.basename(absoluteTarget)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    try {
        fs.writeFileSync(temporary, value, { mode: 0o600 });
        fs.renameSync(temporary, absoluteTarget);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

function writeJsonAtomic(targetPath, value) {
    writeBufferAtomic(targetPath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

module.exports = {
    ALGORITHM,
    KDF,
    PASSWORD_ENV,
    ProfileCryptoError,
    decryptEnvelope,
    encryptBuffer,
    parseEnvelope,
    readPassword,
    readPasswordFromSources,
    readSecretFromSources,
    rotateEnvelope,
    verifyEnvelope,
    writeBufferAtomic,
    writeJsonAtomic,
};

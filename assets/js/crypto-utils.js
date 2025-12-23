export class CryptoUtils {
    constructor() {
        this.algo = { name: 'AES-GCM', length: 256 };
    }

    async deriveKey(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        return window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            this.algo,
            false,
            ['encrypt', 'decrypt']
        );
    }

    async encrypt(data, password) {
        const enc = new TextEncoder();
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const key = await this.deriveKey(password, salt);

        const encrypted = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            enc.encode(JSON.stringify(data))
        );

        // Convert buffers to base64 strings for storage
        return {
            salt: this.bufferToBase64(salt),
            iv: this.bufferToBase64(iv),
            data: this.bufferToBase64(encrypted)
        };
    }

    async decrypt(encryptedPkg, password) {
        const salt = this.base64ToBuffer(encryptedPkg.salt);
        const iv = this.base64ToBuffer(encryptedPkg.iv);
        const data = this.base64ToBuffer(encryptedPkg.data);

        try {
            const key = await this.deriveKey(password, salt);
            const decrypted = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                data
            );

            const dec = new TextDecoder();
            return JSON.parse(dec.decode(decrypted));
        } catch (e) {
            throw new Error("Password non valida o dati corrotti");
        }
    }

    bufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    base64ToBuffer(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes;
    }
}

export const cryptoUtils = new CryptoUtils();
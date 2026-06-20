import { createClient } from 'redis';
import crypto from 'crypto';

const client = createClient({ url: process.env.REDIS_URL || process.env.KV_URL });
client.on('error', (err) => console.error('Redis Error', err));

const CRYPTO_KEY = "MAX_PLANNER_SECRET_TOKEN_2026";

function decrypt(cipher) {
    try {
        let decoded = decodeURIComponent(Buffer.from(cipher, 'base64').toString('utf8'));
        let result = "";
        for(let i=0; i<decoded.length; i++) {
            let charCode = decoded.charCodeAt(i) ^ CRYPTO_KEY.charCodeAt(i % CRYPTO_KEY.length);
            result += String.fromCharCode(charCode);
        }
        return result;
    } catch(e) { return ""; }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Verification');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.headers['x-app-verification'] !== 'MaxPlannerMaster2026') return res.status(401).json({ error: '인증 거부' });

    try {
        const { payload } = req.body;
        const decryptedStr = decrypt(payload);
        if (!decryptedStr) return res.status(400).json({ error: '잘못된 데이터 형식' });

        const { id, pw } = JSON.parse(decryptedStr);

        if (!client.isOpen) await client.connect();

        const userDataStr = await client.get(`user:auth:${id}`);
        if (!userDataStr) {
            return res.status(400).json({ error: 'invalid', message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
        }

        const parsed = JSON.parse(userDataStr);
        const hashedPassword = crypto.createHash('sha256').update(pw).digest('hex');

        if (parsed.password !== hashedPassword) {
            return res.status(400).json({ error: 'invalid', message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
        }

        // 인증 성공 시 클라이언트에 고유 식별 코드(uuid)와 이름 반환
        return res.status(200).json({ success: true, uuid: parsed.uuid, name: parsed.name });
    } catch (error) {
        return res.status(500).json({ error: '서버 오류' });
    }
}
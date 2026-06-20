import { createClient } from 'redis';
import crypto from 'crypto';

const client = createClient({ url: process.env.REDIS_URL || process.env.KV_URL });
client.on('error', (err) => console.error('Redis Error', err));

const CRYPTO_KEY = "MAX_PLANNER_SECRET_TOKEN_2026";

// 프론트엔드와 동일한 대칭키 복호화 알고리즘
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
        // 암호화된 페이로드 수신 및 해독
        const { payload } = req.body;
        const decryptedStr = decrypt(payload);
        if (!decryptedStr) return res.status(400).json({ error: '잘못된 데이터 형식' });

        const { name, id, pw } = JSON.parse(decryptedStr);

        // 서버단 2차 유효성 검증
        if (!name || name.length > 10) return res.status(400).json({ error: '사용자명 오류' });
        if (!id || id.length < 4) return res.status(400).json({ error: '아이디 오류' });
        if (!pw || pw.length < 8) return res.status(400).json({ error: '비밀번호 오류' });

        if (!client.isOpen) await client.connect();

        // 중복 확인
        const existing = await client.get(`user:auth:${id}`);
        if (existing) {
            return res.status(400).json({ error: 'duplicate', message: '이미 사용 중인 아이디입니다.' });
        }

        // 고유 식별 코드(UUID) 랜덤 발급 및 계정 저장
        const uuid = crypto.randomUUID();
        const hashedPassword = crypto.createHash('sha256').update(pw).digest('hex');

        await client.set(`user:auth:${id}`, JSON.stringify({ uuid, password: hashedPassword, name }));

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: '서버 오류' });
    }
}
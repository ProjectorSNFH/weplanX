import { createClient } from 'redis';
import crypto from 'crypto';

const client = createClient({ url: process.env.REDIS_URL || process.env.KV_URL });
client.on('error', (err) => console.error('❌ [SIGNUP] Redis Error:', err));

const CRYPTO_KEY = "MAX_PLANNER_SECRET_TOKEN_2026";
let authRamStorage = {};

function decrypt(cipher) {
    try {
        let decoded = decodeURIComponent(Buffer.from(cipher, 'base64').toString('utf8'));
        let result = "";
        for(let i=0; i<decoded.length; i++) {
            let charCode = decoded.charCodeAt(i) ^ CRYPTO_KEY.charCodeAt(i % CRYPTO_KEY.length);
            result += String.fromCharCode(charCode);
        }
        return result;
    } catch(e) { 
        console.error("❌ [SIGNUP] Payload Decrypt Error:", e.message);
        return ""; 
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Verification');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-App-Verification'
    ); 

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.headers['x-app-verification'] !== 'MaxPlannerMaster2026') {
        console.warn("⚠️ [SIGNUP] 앱 인증 헤더 불일치 거부");
        return res.status(401).json({ error: '인증 거부' });
    }

    try {
        const { payload } = req.body;
        console.log("📥 [SIGNUP] 회원가입 요청 수신");

        const decryptedStr = decrypt(payload);
        if (!decryptedStr) return res.status(400).json({ error: '잘못된 데이터 형식' });

        const { name, id, pw } = JSON.parse(decryptedStr);
        console.log(`🔍 [SIGNUP] 검증 시작 - ID: ${id}, Name: ${name}`);

        if (!name || name.length > 10) return res.status(400).json({ error: '사용자명 오류' });
        if (!id || id.length < 4) return res.status(400).json({ error: '아이디 오류' });
        if (!pw || pw.length < 8) return res.status(400).json({ error: '비밀번호 오류' });

        // 1. RAM 캐시 중복 확인
        if (authRamStorage[id]) {
            console.warn(`⚠️ [SIGNUP] 가입 중복 거부 (RAM 캐시 적중) - ID: ${id}`);
            return res.status(400).json({ error: 'duplicate', message: '이미 사용 중인 아이디입니다.' });
        }

        // Redis 연결 및 실제 조회
        if (!client.isOpen) await client.connect();
        const existing = await client.get(`user:auth:${id}`);
        if (existing) {
            console.warn(`⚠️ [SIGNUP] 가입 중복 거부 (Redis 스토리지 적중) - ID: ${id}`);
            return res.status(400).json({ error: 'duplicate', message: '이미 사용 중인 아이디입니다.' });
        }

        // UUID 및 비밀번호 해싱
        const uuid = crypto.randomUUID();
        const hashedPassword = crypto.createHash('sha256').update(pw).digest('hex');
        const userData = { uuid, password: hashedPassword, name };

        // 2. RAM 캐시 우선 적재
        authRamStorage[id] = userData;
        console.log(`⚡ [SIGNUP] RAM 캐시 적재 완료 - ID: ${id}, UUID: ${uuid}`);

        // 3. 비동기 백그라운드 스토리지 커밋
        client.set(`user:auth:${id}`, JSON.stringify(userData))
            .then(() => console.log(`💾 [SIGNUP] 백그라운드 Redis Commit 완료 - ID: ${id}`))
            .catch(e => console.error(`❌ [SIGNUP] Redis Commit 실패 - ID: ${id}:`, e));

        // 4. 프론트엔드 응답
        console.log(`✅ [SIGNUP] 가입 처리 완료 응답 전송 - ID: ${id}`);
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("❌ [SIGNUP] 서버 내부 오류 발생:", error);
        return res.status(500).json({ error: '서버 오류' });
    }
}
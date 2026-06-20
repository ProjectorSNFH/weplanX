import { createClient } from 'redis';
import crypto from 'crypto';

const client = createClient({ url: process.env.REDIS_URL || process.env.KV_URL });
client.on('error', (err) => console.error('Redis Error', err));

const CRYPTO_KEY = "MAX_PLANNER_SECRET_TOKEN_2026";

// 🧠 회원가입 임시 RAM 캐시 스토리지
let authRamStorage = {};

// 프론트엔드와 동일한 대칭키 복호화 알고리즘 (XOR)
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
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-App-Verification'
    ); 

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.headers['x-app-verification'] !== 'MaxPlannerMaster2026') return res.status(401).json({ error: '인증 거부' });

    try {
        const { payload } = req.body;
        const decryptedStr = decrypt(payload);
        if (!decryptedStr) return res.status(400).json({ error: '잘못된 데이터 형식' });

        const { name, id, pw } = JSON.parse(decryptedStr);

        // 서버단 2차 유효성 검증
        if (!name || name.length > 10) return res.status(400).json({ error: '사용자명 오류' });
        if (!id || id.length < 4) return res.status(400).json({ error: '아이디 오류' });
        if (!pw || pw.length < 8) return res.status(400).json({ error: '비밀번호 오류' });

        // 1. RAM 캐시에서 먼저 중복 확인 후, 없으면 Redis 조회
        if (authRamStorage[id]) {
            return res.status(400).json({ error: 'duplicate', message: '이미 사용 중인 아이디입니다.' });
        }

        if (!client.isOpen) await client.connect();
        const existing = await client.get(`user:auth:${id}`);
        if (existing) {
            return res.status(400).json({ error: 'duplicate', message: '이미 사용 중인 아이디입니다.' });
        }

        // 고유 식별 코드(UUID) 및 계정 정보 생성
        const uuid = crypto.randomUUID();
        const hashedPassword = crypto.createHash('sha256').update(pw).digest('hex');
        const userData = { uuid, password: hashedPassword, name };

        // 2. [RAM 우선 적재] 메모리에 먼저 계정 정보 보관
        authRamStorage[id] = userData;

        // 3. [비동기 스토리지 커밋] Redis 저장은 백그라운드에서 진행 (await 제거)
        client.set(`user:auth:${id}`, JSON.stringify(userData))
            .catch(e => console.error("Redis Auth Commit Error:", e));

        // 4. 프론트엔드에게 즉시 완료 응답 반환
        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: '서버 오류' });
    }
}
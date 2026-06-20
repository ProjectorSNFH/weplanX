import { createClient } from 'redis';
import crypto from 'crypto';

const client = createClient({ url: process.env.REDIS_URL || process.env.KV_URL });
client.on('error', (err) => console.error('❌ [PLANNER] Redis Error:', err));

const CRYPTO_KEY = "MAX_PLANNER_SECRET_TOKEN_2026";
const AES_KEY = crypto.createHash('sha256').update(CRYPTO_KEY).digest(); 
const IV_LENGTH = 16;

let ramStorage = {}; 
let isLoaded = {};
let loadPromises = {};
let lastSaveTimes = {};
const SAVE_INTERVAL = 30000;

// AES-256 암호화 (Redis 백업용)
function encryptAES(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

// AES-256 복호화 (Redis 로드용)
function decryptAES(text) {
    try {
        if (!text) return "";
        const parts = text.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encryptedText = Buffer.from(parts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error("❌ [PLANNER] AES Decryption Error:", e.message);
        return "";
    }
}

function decryptUUID(cipher) {
    try {
        let decoded = decodeURIComponent(Buffer.from(cipher, 'base64').toString('utf8'));
        let result = "";
        for(let i=0; i<decoded.length; i++) {
            let charCode = decoded.charCodeAt(i) ^ CRYPTO_KEY.charCodeAt(i % CRYPTO_KEY.length);
            result += String.fromCharCode(charCode);
        }
        return result;
    } catch(e) { 
        console.error("❌ [PLANNER] UUID Decrypt Error:", e.message);
        return ""; 
    }
}

async function ensureRamLoaded(uuid) {
    if (isLoaded[uuid]) {
        console.log(`🎯 [PLANNER] RAM Cache Hit! - UUID: ${uuid}`);
        return;
    }
    if (!loadPromises[uuid]) {
        loadPromises[uuid] = (async () => {
            console.log(`🔄 [PLANNER] RAM Cache Miss. Redis에서 로드 시작 - UUID: ${uuid}`);
            if (!client.isOpen) await client.connect();
            const savedData = await client.get(`user:data:${uuid}`);
            
            // Redis 고강도 AES 데이터를 복호화하여 가벼운 RAM 스토리지 구조로 복구
            ramStorage[uuid] = savedData ? decryptAES(savedData) : ""; 
            isLoaded[uuid] = true;
            console.log(`📦 [PLANNER] Redis 데이터 로드 및 AES 복호화 완료 - UUID: ${uuid}`);
        })();
    }
    await loadPromises[uuid];
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Verification');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-App-Verification'
    ); 
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.headers['x-app-verification'] !== 'MaxPlannerMaster2026') {
        console.warn("⚠️ [PLANNER] 앱 인증 헤더 불일치 거부");
        return res.status(401).json({ error: '인증 거부' });
    }

    try {
        if (req.method === 'GET') {
            const encryptedUuid = req.query.uuid;
            const uuid = decryptUUID(encryptedUuid);
            if(!uuid) return res.status(400).json({ error: '식별 오류' });

            await ensureRamLoaded(uuid);
            console.log(`📤 [PLANNER] GET 응답 전송 (XOR 페이로드 데이터 포함) - UUID: ${uuid}`);
            return res.status(200).json({ payload: ramStorage[uuid] });
        } 
        
        if (req.method === 'POST') {
            const { uuid: encryptedUuid, payload } = req.body;
            const uuid = decryptUUID(encryptedUuid);
            if(!uuid) return res.status(400).json({ error: '식별 오류' });

            await ensureRamLoaded(uuid);
            
            // 즉시 가벼운 XOR 암호화 데이터를 RAM 적재
            ramStorage[uuid] = payload || "";
            console.log(`⚡ [PLANNER] 실시간 변경 데이터 RAM 적재 완료 - UUID: ${uuid}`);

            // 30초 주기 타이머 체크하여 Redis에 저장
            const now = Date.now();
            const lastSave = lastSaveTimes[uuid] || 0;
            if (now - lastSave >= SAVE_INTERVAL) {
                lastSaveTimes[uuid] = now;
                console.log(`⏳ [PLANNER] 30초 주기 도달 -> Redis 백그라운드 덤프 예약 시작 - UUID: ${uuid}`);
                
                if (!client.isOpen) await client.connect();
                
                // 스토리지용 AES-256 강력 암호화 포장 후 비동기 저장
                const strongEncryptedData = encryptAES(ramStorage[uuid]);
                client.set(`user:data:${uuid}`, strongEncryptedData)
                    .then(() => console.log(`💾 [PLANNER] AES-256 암호화 및 Redis 백그라운드 덤프 완료! - UUID: ${uuid}`))
                    .catch(e => console.error(`❌ [PLANNER] Redis 덤프 실패 - UUID: ${uuid}:`, e));
            } else {
                console.log(`⏱️ [PLANNER] 덤프 주기 미도달 (다음 덤프까지 대기) - 경과: ${Math.floor((now - lastSave)/1000)}초 / 30초`);
            }
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: '메서드 오류' });
    } catch (error) {
        console.error("❌ [PLANNER] 서버 내부 오류 발생:", error);
        return res.status(500).json({ error: '서버 내부 오류' });
    }
}
import { createClient } from 'redis';
import crypto from 'crypto';

const client = createClient({ url: process.env.REDIS_URL || process.env.KV_URL });
client.on('error', (err) => console.error('Redis Error', err));

const CRYPTO_KEY = "MAX_PLANNER_SECRET_TOKEN_2026";

// 🔐 스토리지(Redis) 전용 강력한 AES-256 키 및 IV 설정 생성
const AES_KEY = crypto.createHash('sha256').update(CRYPTO_KEY).digest(); // 32바이트 키 유도
const IV_LENGTH = 16;

// [스토리지용] 강력한 AES-256-CBC 암호화 함수
function encryptAES(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // IV와 암호문을 결합하여 저장
    return iv.toString('hex') + ':' + encrypted;
}

// [스토리지용] AES-256-CBC 복호화 함수 (RAM으로 복구할 때 사용)
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
        console.error("AES Decryption Error", e);
        return "";
    }
}

// 식별용 UUID만 해독하는 함수 (XOR)
function decryptUUID(cipher) {
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

// 🧠 하이브리드 RAM 캐시
let ramStorage = {}; 
let isLoaded = {};
let loadPromises = {};
let lastSaveTimes = {};
const SAVE_INTERVAL = 30000;

async function ensureRamLoaded(uuid) {
    if (isLoaded[uuid]) return;
    if (!loadPromises[uuid]) {
        loadPromises[uuid] = (async () => {
            if (!client.isOpen) await client.connect();
            const savedData = await client.get(`user:data:${uuid}`);
            
            // 💡 영구 저장소에서 가져온 대용량 AES 암호문을 해독하여 RAM에는 가벼운 XOR 암호문 상태로 적재합니다.
            ramStorage[uuid] = savedData ? decryptAES(savedData) : ""; 
            isLoaded[uuid] = true;
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
    if (req.headers['x-app-verification'] !== 'MaxPlannerMaster2026') return res.status(401).json({ error: '인증 거부' });

    try {
        if (req.method === 'GET') {
            const encryptedUuid = req.query.uuid;
            const uuid = decryptUUID(encryptedUuid);
            if(!uuid) return res.status(400).json({ error: '식별 오류' });

            await ensureRamLoaded(uuid);
            // 프론트엔드가 해독할 수 있도록 RAM에 있던 XOR 암호화 레이어 그대로 반환
            return res.status(200).json({ payload: ramStorage[uuid] });
        } 
        
        if (req.method === 'POST') {
            const { uuid: encryptedUuid, payload } = req.body;
            const uuid = decryptUUID(encryptedUuid);
            if(!uuid) return res.status(400).json({ error: '식별 오류' });

            await ensureRamLoaded(uuid);
            
            // 프론트엔드가 보낸 XOR 암호화 데이터 통째로 RAM 적재
            ramStorage[uuid] = payload || "";

            const now = Date.now();
            const lastSave = lastSaveTimes[uuid] || 0;
            if (now - lastSave >= SAVE_INTERVAL) {
                lastSaveTimes[uuid] = now;
                if (!client.isOpen) await client.connect();
                
                // 💡 [보안 강화] 스토리지에 백그라운드 덤프를 뜰 때는 훨씬 강력한 AES-256-CBC로 2차 암호화하여 커밋합니다.
                const strongEncryptedData = encryptAES(ramStorage[uuid]);
                client.set(`user:data:${uuid}`, strongEncryptedData).catch(e => console.error(e));
            }
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: '메서드 오류' });
    } catch (error) {
        return res.status(500).json({ error: '서버 내부 오류' });
    }
}
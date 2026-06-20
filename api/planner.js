import { createClient } from 'redis';

const client = createClient({ url: process.env.REDIS_URL || process.env.KV_URL });
client.on('error', (err) => console.error('Redis Error', err));

const CRYPTO_KEY = "MAX_PLANNER_SECRET_TOKEN_2026";

// 식별용 UUID만 해독하는 함수
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
            ramStorage[uuid] = savedData || ""; // 암호화된 문자열 그대로 유지
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
            // 암호화된 플래너 데이터 그대로 반환
            return res.status(200).json({ payload: ramStorage[uuid] });
        } 
        
        if (req.method === 'POST') {
            const { uuid: encryptedUuid, payload } = req.body;
            const uuid = decryptUUID(encryptedUuid);
            if(!uuid) return res.status(400).json({ error: '식별 오류' });

            await ensureRamLoaded(uuid);
            
            // 암호화된 데이터 통째로 RAM 적재
            ramStorage[uuid] = payload || "";

            const now = Date.now();
            const lastSave = lastSaveTimes[uuid] || 0;
            if (now - lastSave >= SAVE_INTERVAL) {
                lastSaveTimes[uuid] = now;
                if (!client.isOpen) await client.connect();
                // 백그라운드 덤프
                client.set(`user:data:${uuid}`, ramStorage[uuid]).catch(e => console.error(e));
            }
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: '메서드 오류' });
    } catch (error) {
        return res.status(500).json({ error: '서버 내부 오류' });
    }
}
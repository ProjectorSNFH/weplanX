import { createClient } from 'redis';

// 🔒 토큰이 필요 없는 구조: URL 내부에 비밀번호가 포함되어 있으므로 주소 하나만 넣어줍니다.
const client = createClient({
    url: process.env.REDIS_URL || process.env.KV_URL
});

client.on('error', (err) => console.error('Redis Client Error', err));

const STORAGE_KEY = 'max_planner_global_payload';

// ==========================================
// 🧠 [코어] 100% 서버 램(RAM) 데이터 상주 공간
// ==========================================
let ramStorage = ""; 
let isLoaded = false;                 // DB에서 램으로 로딩이 끝났는지 체크
let initializationPromise = null;     // 로딩 과정을 홀딩할 프라미스 객체

let lastSaveTime = 0;                 // 마지막 백업 타임스탬프
const SAVE_INTERVAL = 30000;          // ⏱️ 장기 스토리지 백업 주기 (30초)
// ==========================================

// 🚦 [서버 재시작 관문] 램에 데이터가 없으면 들어오는 모든 요청을 "걍 기다리게" 만듭니다.
async function ensureRamLoaded() {
    if (isLoaded) return; 
    
    if (!initializationPromise) {
        initializationPromise = (async () => {
            console.log("🔄 [서버 재시작] 하나뿐인 URL을 통해 스토리지를 풀어서 램(RAM)으로 데이터를 구워옵니다...");
            try {
                if (!client.isOpen) await client.connect();
                const savedData = await client.get(STORAGE_KEY);
                ramStorage = savedData || "";
                isLoaded = true;
                console.log("✅ [서버 재시작] 램으로 이관 완료! 이제 램으로만 소통합니다.");
            } catch (error) {
                console.error("❌ [서버 재시작] 로딩 중 실패:", error);
                initializationPromise = null; 
                throw error;
            }
        })();
    }
    
    // 🚦 로딩 중일 때 프론트엔드가 요청을 보내면 로딩 끝날 때까지 여기서 멍하니 대기하게 됩니다.
    await initializationPromise;
}

export default async function handler(req, res) {
    // CORS 및 프리플라이트 완벽 방어
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Verification');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 앱 위조 방지 검증 키 체크
    const verifyKey = req.headers['x-app-verification'];
    if (verifyKey !== 'MaxPlannerMaster2026') {
        return res.status(401).json({ error: '인증되지 않은 요청입니다.' });
    }

    try {
        // 🚦 로딩 중이면 묻지도 따지지도 않고 대기 조치
        await ensureRamLoaded();

        // 📥 [GET 요청]: 프론트엔드가 불러올 때 -> 무조건 램(RAM)에서 즉시 꺼내줌
        if (req.method === 'GET') {
            console.log("⚡ [프론트 통신] 오직 램(RAM)에서 꺼낸 데이터를 초고속 반환합니다.");
            return res.status(200).json({ payload: ramStorage });
        } 
        
        // 📤 [POST 요청]: 프론트엔드가 저장할 때 -> 무조건 램(RAM)에 먼저 얹음
        if (req.method === 'POST') {
            const { payload } = req.body;
            
            ramStorage = payload || "";
            console.log("⚡ [프론트 통신] 데이터를 램(RAM)에 즉시 얹었습니다. 프론트엔드 대기 해제.");

            // ⏱️ 주기적 백업 메커니즘 (지정한 시간 주기가 지났을 때만 스토리지에 백업 실행)
            const now = Date.now();
            if (now - lastSaveTime >= SAVE_INTERVAL) {
                lastSaveTime = now;
                console.log("⏱️ [주기적 백업] 지정된 주기가 되어 램의 데이터를 스토리지로 복사(Dump)합니다.");
                if (!client.isOpen) await client.connect();
                await client.set(STORAGE_KEY, ramStorage);
                console.log("✅ [주기적 백업] 스토리지 안전 백업 완료!");
            }

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });

    } catch (error) {
        console.error("❌ 하이브리드 서버 에러:", error);
        return res.status(500).json({ error: '서버 오류 발생', details: error.message });
    }
}
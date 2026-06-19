import { Redis } from '@upstash/redis';

// 🔒 보안 환경 변수 매핑
const redis = new Redis({
  url: process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "" 
});

const STORAGE_KEY = 'max_planner_global_payload';

// ==========================================
// 🧠 [코어] 100% 서버 RAM 데이터 공간 및 제어 변수
// ==========================================
let ramStorage = ""; 
let isLoaded = false;                 // DB에서 램으로 로딩이 완료되었는지 여부
let initializationPromise = null;     // 로딩 과정을 관리하는 약속(Promise) 객체

let lastSaveTime = 0;                 // 마지막으로 스토리지에 저장한 시간
const SAVE_INTERVAL = 30000;          // ⏱️ 백업 주기 (30000ms = 30초, 원하는 대로 조정 가능)
// ==========================================

// 🔄 [서버 재시작 대응] 스토리지가 장기 저장소에서 램으로 데이터를 불러오는 로직
async function ensureRamLoaded() {
    if (isLoaded) return; // 이미 램에 로드되어 있다면 즉시 통과
    
    // 아직 로딩 시작을 안 했다면, 최초 1회만 로딩 프로세스를 가동합니다.
    if (!initializationPromise) {
        initializationPromise = (async () => {
            console.log("🔄 [서버 재시작] 스토리지(Redis) -> 램(RAM)으로 데이터 로딩을 시작합니다...");
            try {
                const savedData = await redis.get(STORAGE_KEY);
                ramStorage = savedData || "";
                isLoaded = true;
                console.log("✅ [서버 재시작] 램으로 로딩 완료! 이제 서비스를 시작합니다.");
            } catch (error) {
                console.error("❌ [서버 재시작] 로딩 중 에러 발생:", error);
                initializationPromise = null; // 실패 시 다음 요청이 재시도할 수 있도록 초기화
                throw error;
            }
        })();
    }
    
    // 🚦 [정체 구간] 만약 첫 요청이 DB에서 데이터를 가져오는 중(로딩 중)에 
    // 다른 요청들이 들어오면, 이 라인에서 로딩이 완전히 끝날 때까지 "걍 기다리게" 됩니다.
    await initializationPromise;
}

// ☁️ [백그라운드 백업] 프론트엔드를 기다리게 하지 않고 주기적으로 스토리지에 덤프
function checkAndPeriodicSave() {
    const now = Date.now();
    // 설정한 주기(예: 30초)가 지났다면 백업을 실행합니다.
    if (now - lastSaveTime >= SAVE_INTERVAL) {
        lastSaveTime = now;
        console.log("⏱️ [주기적 백업] 지정된 주기가 되어 램의 데이터를 스토리지로 복사합니다... (비동기)");
        
        // 💡 await을 붙이지 않고 실행(Fire-and-Forget)하여 
        // 스토리지 저장 속도와 관계없이 프론트엔드 응답은 즉시 처리되도록 합니다.
        redis.set(STORAGE_KEY, ramStorage)
            .then(() => console.log("✅ [주기적 백업] 스토리지 안전 백업 완료!"))
            .catch(err => console.error("❌ [주기적 백업] 백업 실패:", err));
    }
}

export default async function handler(req, res) {
    // 1. CORS 및 프리플라이트 완벽 방어
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Verification');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. 앱 위조 방지 검증 키 체크
    const verifyKey = req.headers['x-app-verification'];
    if (verifyKey !== 'MaxPlannerMaster2026') {
        return res.status(401).json({ error: '인증되지 않은 요청입니다.' });
    }

    try {
        // 🚦 [최우선 관문] 서버가 꺼졌다 켜진 상태라면, 램 로딩이 끝날 때까지 요청을 대기시킵니다.
        await ensureRamLoaded();

        // 📥 [GET 요청]: 프론트엔드가 데이터를 달라고 할 때
        if (req.method === 'GET') {
            console.log("⚡ [RAM 읽기] 오직 램(RAM)에 있는 데이터를 즉시 반환합니다.");
            return res.status(200).json({ payload: ramStorage });
        } 
        
        // 📤 [POST 요청]: 프론트엔드가 데이터를 보냈을 때
        if (req.method === 'POST') {
            const { payload } = req.body;
            
            // 무조건 램에 먼저 0.0001초 만에 저장
            ramStorage = payload || "";
            console.log("⚡ [RAM 쓰기] 프론트엔드 데이터를 램(RAM)에 즉시 얹었습니다.");

            // 매 저장 요청마다 주기를 체크하여 백그라운드 백업 실행 (프론트 대기 없음)
            checkAndPeriodicSave();

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });

    } catch (error) {
        console.error("❌ 하이브리드 서버 코어 에러:", error);
        return res.status(500).json({ error: '서버 오류 발생', details: error.message });
    }
}
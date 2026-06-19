import { Redis } from '@upstash/redis';

// 🔒 보안 환경 변수로 Redis 연결
const redis = new Redis({
  url: process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "" 
});

const STORAGE_KEY = 'max_planner_global_payload';

// 🧠 1차 기지: 초고속 처리를 위한 서버 RAM 공간 (글로벌 변수)
let ramStorage = ""; 
let isRamLoadedFromDB = false; // 서버가 방금 깨어났는지 확인하는 플래그

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
        // 📥 [GET 요청]: 데이터를 가져갈 때
        if (req.method === 'GET') {
            // 만약 서버가 방금 깨어나서 램이 비어있다면, 스토리지(DB)에서 램을 먼저 복구합니다.
            if (!isRamLoadedFromDB) {
                console.log("🔄 [하이브리드] 서버가 깨어남: 스토리지에서 램으로 복구 작업을 진행합니다.");
                const savedData = await redis.get(STORAGE_KEY);
                ramStorage = savedData || "";
                isRamLoadedFromDB = true; // 복구 완료 표시
            }

            console.log("⚡ [하이브리드] 램(RAM)에서 데이터를 번개처럼 꺼내 반환합니다.");
            return res.status(200).json({ payload: ramStorage });
        } 
        
        // 📤 [POST 요청]: 데이터를 저장할 때
        if (req.method === 'POST') {
            const { payload } = req.body;
            
            // 1순위: 프론트엔드가 대기하지 않도록 램에 즉시 반영
            ramStorage = payload || "";
            isRamLoadedFromDB = true; 
            console.log("✅ [하이브리드] 1차 저장: 램(RAM)에 실시간 적재 완료!");

            // 2순위: 서버가 잠들어도 날아가지 않게 스토리지(Redis DB)에 장기 보관 동기화
            await redis.set(STORAGE_KEY, ramStorage);
            console.log("☁️ [하이브리드] 2차 동기화: 스토리지(Redis)로 장기 저장 안전하게 완료!");

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });

    } catch (error) {
        console.error("❌ 하이브리드 서버 에러 발생:", error);
        return res.status(500).json({ error: '서버 오류 발생', details: error.message });
    }
}
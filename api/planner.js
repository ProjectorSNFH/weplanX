import { Redis } from '@upstash/redis';

// Vercel 환경 변수에 맞춰서 알아서 서버 주소를 가져옵니다.
const kv = Redis.fromEnv();

export default async function handler(req, res) {
    // 1. CORS 헤더 설정
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

    const STORAGE_KEY = 'max_planner_global_payload';

    try {
        // 📥 [GET 요청]: 데이터 불러오기
        if (req.method === 'GET') {
            console.log("▶ [서버] Redis로부터 데이터를 조회합니다.");
            const savedPayload = await kv.get(STORAGE_KEY);
            
            return res.status(200).json({ payload: savedPayload || "" });
        } 
        
        // 📤 [POST 요청]: 데이터 저장하기
        if (req.method === 'POST') {
            const { payload } = req.body;
            if (!payload) {
                return res.status(400).json({ error: '저장할 내용(payload)이 없습니다.' });
            }

            // Redis에 데이터 저장
            await kv.set(STORAGE_KEY, payload);
            console.log("✅ [서버] Redis에 데이터 저장 성공!");
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });

    } catch (error) {
        console.error("❌ Redis 통신 중 서버 에러 발생:", error);
        return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.', details: error.message });
    }
}
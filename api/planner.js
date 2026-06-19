import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    // 1. 외부(Live Server, localhost 등) 통신을 위한 CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Verification');

    // 브라우저가 본 요청 전에 보내는 사전 검사(OPTIONS) 처리
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. 앱 위조 방지 검증 키 체크 (클라이언트와 일치해야 함)
    const verifyKey = req.headers['x-app-verification'];
    if (verifyKey !== 'MaxPlannerMaster2026') {
        return res.status(401).json({ error: '인증되지 않은 요청입니다.' });
    }

    // 3. Redis에 데이터를 저장할 고유 키 이름 정의
    const STORAGE_KEY = 'max_planner_global_payload';

    try {
        // 📥 [GET 요청]: 클라우드에서 플래너 데이터 불러오기
        if (req.method === 'GET') {
            console.log("▶ [서버] Redis로부터 데이터를 조회합니다.");
            const savedPayload = await kv.get(STORAGE_KEY);
            
            // 데이터가 비어있다면 빈 문자열("")을 반환하여 클라이언트 에러 방지
            return res.status(200).json({ payload: savedPayload || "" });
        } 
        
        // 📤 [POST 요청]: 클라우드에 플래너 데이터 백업하기
        if (req.method === 'POST') {
            const { payload } = req.body;
            if (!payload) {
                return res.status(400).json({ error: '저장할 내용(payload)이 없습니다.' });
            }

            // Vercel KV(Redis)에 데이터 무조건 덮어쓰기 저장
            await kv.set(STORAGE_KEY, payload);
            console.log("✅ [서버] Redis에 데이터 저장 성공!");
            return res.status(200).json({ success: true });
        }

        // GET, POST 외의 요청이 들어온 경우 처리
        return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });

    } catch (error) {
        // 에러 발생 시 Vercel 콘솔 로그에서 확인할 수 있도록 출력
        console.error("❌ Vercel KV 통신 중 서버 에러 발생:", error);
        return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.', details: error.message });
    }
}
// 💡 서버가 켜져 있는 동안 데이터를 임시 저장할 RAM 공간 (글로벌 변수)
let ramStorage = ""; 

export default async function handler(req, res) {
    // 1. CORS 및 프리플라이트(OPTIONS) 완벽 방어 설정
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
        // 📥 [GET 요청]: 프론트엔드가 데이터를 달라고 할 때 (Cloud Load)
        if (req.method === 'GET') {
            console.log("▶ [서버 RAM] 현재 메모리에 저장된 데이터를 보냅니다.");
            return res.status(200).json({ payload: ramStorage });
        } 
        
        // 📤 [POST 요청]: 프론트엔드가 데이터를 보냈을 때 (Cloud Save)
        if (req.method === 'POST') {
            const { payload } = req.body;
            
            // 데이터가 없더라도 빈 값("")을 허용하도록 설정
            ramStorage = payload !== undefined ? payload : "";
            
            console.log("✅ [서버 RAM] 프론트엔드로부터 받은 데이터를 RAM에 임시 저장했습니다!");
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });

    } catch (error) {
        console.error("❌ 서버 내부 에러 발생:", error);
        return res.status(500).json({ error: '서버 오류 발생', details: error.message });
    }
}
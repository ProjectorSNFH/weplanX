// Node.js Serverless Environment
// api/planner.js

// 프로덕션급 영구 파일 디스크 저장 모듈 또는 인메모리 임시 캐시 세팅
let globalCloudBackupStore = {
  payload: "" 
};

export default function handler(req, res) {
  // CORS 기본 헤더 구성
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-App-Verification');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  /* ======================================================
  [보안 기능 주석 처리] 프론트엔드가 보낸 요청이 맞는지 검증 알고리즘
  ======================================================
  const appVerificationToken = req.headers['x-app-verification'];
  const allowedOrigin = "https://your-frontend-domain.vercel.app"; // 실제 웹 도메인 지정용
  
  if (!appVerificationToken || appVerificationToken !== 'MaxPlannerMaster2026') {
      return res.status(403).json({ error: "Access Denied: Unverified application source." });
  }
  if (req.headers.origin && req.headers.origin !== allowedOrigin) {
      return res.status(403).json({ error: "Access Denied: Invalidation of Origin header authentication." });
  }
  */

  // 1. 저장 데이터 업로드 API 분기 (POST)
  if (req.method === 'POST') {
    try {
      const { payload } = req.body;
      if (!payload) {
        return res.status(400).json({ error: "Bad Request: No payload detected" });
      }

      // 서버는 복호화 키가 없으므로 전달된 암호문 그대로 버퍼 스토어에 바인딩
      globalCloudBackupStore.payload = payload;

      return res.status(200).json({ success: true, message: "Storage complete" });
    } catch (err) {
      return res.status(500).json({ error: "Server Internal Processing Error" });
    }
  }

  // 2. 동기화 데이터 복구 API 분기 (GET)
  if (req.method === 'GET') {
    try {
      return res.status(200).json({
        payload: globalCloudBackupStore.payload || ""
      });
    } catch (err) {
      return res.status(500).json({ error: "Server Internal Load Error" });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
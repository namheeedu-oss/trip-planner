// Vercel 함수: Gemini API(gemini-3.8-flash)를 호출하여 맞춤형 여행 일정을 생성한다.
// 인증키는 Vercel 환경변수 GEMINI_API_KEY에서 읽는다.

export default {
  async fetch(request) {
    // 1. HTTP 메서드 확인 (POST 요청만 허용)
    if (request.method !== 'POST') {
      return Response.json(
        { error: 'POST 요청만 지원합니다.' },
        { status: 405, headers: { Allow: 'POST' } }
      );
    }

    // 2. 환경변수 확인
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: 'GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다.' },
        { status: 500 }
      );
    }

    // 3. 요청 바디 파싱
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: '올바른 JSON 요청 본문이 아닙니다.' },
        { status: 400 }
      );
    }

    const { destination, duration, companion, interests } = body;

    if (!destination || typeof destination !== 'string' || !destination.trim()) {
      return Response.json(
        { error: '여행지(destination)를 입력해 주세요.' },
        { status: 400 }
      );
    }

    const parsedDuration = parseInt(duration, 10) || 1;
    const companionText = companion || '혼자';
    const interestList = Array.isArray(interests) && interests.length > 0 
      ? interests.join(', ') 
      : '일반 관광 및 휴식';

    // 4. 시스템 프롬프트 및 안전 가이드라인
    const systemInstruction = `당신은 여행 일정 전문 AI 플래너입니다.
다음 지침을 철저하게 준수하세요:
1. 사용자의 요청이 실제 지리적 여행지 및 여행 일정 계획과 전혀 무관하거나 악의적인 요청인 경우, 반드시 error 속성에 사유를 담고 days는 빈 배열로 반환하세요.
2. 각 방문지의 영업시간, 휴무일, 입장료, 교통 요금 등 변동 가능성이 높은 정보는 '변동 가능성이 있으니 사전 확인 필요', '현장 안내 확인 권장' 등의 완곡한 표현을 사용하고 확정적으로 단정하지 마세요.
3. 요청된 기간(${parsedDuration}일)에 맞추어 Day 1부터 Day ${parsedDuration}까지 동선이 효율적인 시간대별 일정을 알차게 구성하세요.
4. 모든 응답은 지정된 JSON 스키마 규격에 정확히 맞추어 출력하세요.`;

    const userPrompt = `[여행 계획 요청]
- 여행지: ${destination}
- 기간: ${parsedDuration}일 코스
- 동행: ${companionText}
- 취향 및 관심사: ${interestList}

위 조건을 바탕으로 상세하고 현실적인 일정을 생성해 주세요.`;

    // 5. 프론트엔드 연동을 위한 JSON 스키마 정의
    const responseSchema = {
      type: "OBJECT",
      properties: {
        title: { type: "STRING", description: "여행 일정의 매력적인 메인 타이틀" },
        summary: { type: "STRING", description: "동행 및 테마가 반영된 1~2문장의 일정 요약" },
        destination: { type: "STRING", description: "여행지 이름" },
        durationDays: { type: "INTEGER", description: "총 여행 일수" },
        days: {
          type: "ARRAY",
          description: "일자별 세부 일정 목록",
          items: {
            type: "OBJECT",
            properties: {
              day: { type: "INTEGER", description: "일차 번호 (예: 1, 2, 3)" },
              title: { type: "STRING", description: "해당 일차의 테마 또는 지역 요약" },
              spots: {
                type: "ARRAY",
                description: "시간순 방문 스팟 목록",
                items: {
                  type: "OBJECT",
                  properties: {
                    time: { type: "STRING", description: "예상 시간대 (예: 10:00, 12:30, 15:00)" },
                    type: { type: "STRING", enum: ["spot", "food"], description: "식당/카페는 food, 그 외 명소나 이동은 spot" },
                    name: { type: "STRING", description: "장소 또는 활동 명칭" },
                    desc: { type: "STRING", description: "활동 내용 설명 및 추천 포인트 (영업시간/요금은 확정짓지 말고 변동 가능 언급)" },
                    tag: { type: "STRING", description: "스팟 성격 (예: 점심, 카페, 산책, 포토존, 힐링 등)" }
                  },
                  required: ["time", "type", "name", "desc", "tag"]
                }
              }
            },
            required: ["day", "title", "spots"]
          }
        },
        error: { 
          type: "STRING", 
          description: "여행과 무관하거나 부적절한 요청일 경우 사용자에게 보여줄 안내 메시지 (정상일 경우 빈 문자열)" 
        }
      },
      required: ["title", "summary", "destination", "durationDays", "days"]
    };

    try {
      // 6. Gemini 3.8 Flash 엔드포인트 호출
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: responseSchema,
            temperature: 0.7
          }
        })
      });

      if (!geminiResponse.ok) {
        const errorDetail = await geminiResponse.text();
        console.error('Gemini API Error:', errorDetail);
        return Response.json(
          { error: 'Gemini API 호출 중 오류가 발생했습니다.' },
          { status: geminiResponse.status }
        );
      }

      const geminiData = await geminiResponse.json();
      const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        return Response.json(
          { error: 'Gemini로부터 응답을 생성하지 못했습니다.' },
          { status: 502 }
        );
      }

      const parsedPlan = JSON.parse(rawText);

      // 여행과 무관한 요청 거절 처리
      if (parsedPlan.error && parsedPlan.error.trim().length > 0) {
        return Response.json(
          { error: parsedPlan.error },
          { status: 400 }
        );
      }

      // 7. 프론트엔드가 바로 사용할 수 있는 포맷으로 응답 반환
      return Response.json(parsedPlan);

    } catch (e) {
      console.error('Server Function Error:', e);
      return Response.json(
        { error: '일정 생성 중 서버 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
  },
};

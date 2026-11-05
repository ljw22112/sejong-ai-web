import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse
import uvicorn

# API 서버 초기화
app = FastAPI(title="Sejong AI Platform API", version="1.0.0")

# 보안 및 CORS 설정 (프론트엔드와 원활한 통신을 위해 필수)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 사용자가 보낼 질문의 데이터 형태 정의
class ChatRequest(BaseModel):
    message: str = Field(..., example="세종대 공학인증 필수 과목 알려줘")

# AI 응답을 흉내내는 스트리밍 제너레이터 (실제 배포 시 이 부분에 LLM RAG 로직 연결)
async def ai_stream_generator(query: str):
    simulated_response = f"세종대학교 학생이시군요! '{query}'에 대한 답변입니다.\n\n공학인증(ABEEK) 필수 과목은 전공별로 상이하나, 기본적으로 MSC(수학/과학/컴퓨터) 기초 교과목을 이수해야 합니다. 추가적으로 학사 요람을 요약해 드릴까요?"
    
    # 챗GPT처럼 글자가 한 글자씩 타이핑되는 효과를 위한 비동기 처리
    for char in simulated_response:
        yield f"data: {char}\n\n"
        await asyncio.sleep(0.02) 

# 클라이언트의 질문을 받는 메인 채팅 엔드포인트
@app.post("/api/v1/chat/completions")
async def chat_endpoint(request: ChatRequest):
    try:
        return StreamingResponse(ai_stream_generator(request.message), media_type="text/event-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail="서버 내부 오류가 발생했습니다.")

# 로컬 테스트용 실행 코드
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
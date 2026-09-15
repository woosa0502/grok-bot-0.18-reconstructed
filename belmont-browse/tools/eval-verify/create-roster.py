#!/usr/bin/env python3
# Create the production worker roster (OpenAI-only models). Additive + idempotent (clientNonce).
import json, urllib.request, sys
REPO="/home/hoon/_roots/labs/work/Belmont"
gw=json.load(open(f"{REPO}/.cache/belmont-wsl-profile/sand-data/gateway.json"))
PORT,TOK=gw["port"],gw["token"]
def api(method,args):
    req=urllib.request.Request(f"http://127.0.0.1:{PORT}/api/{method}",data=json.dumps(args).encode(),method="POST",
        headers={"content-type":"application/json","authorization":f"Bearer {TOK}"})
    with urllib.request.urlopen(req,timeout=20) as r: return json.loads(r.read().decode())

TAIL="\nBelmont가 [job:<id>]로 맡기면 같은 태그로 회신한다. 큰 결과는 파일로 저장하고 Belmont에는 결론과 참조만 준다. 브라우저·하청(Task)은 필요한 만큼만(보통 하나) 쓰고 동시에 여러 개로 벌리지 않는다. 새 봇은 만들지 않는다(필요하면 Belmont에 요청). 결론 먼저, 짧게."
ROSTER=[
 ("Steward","gpt-5.6-luna","medium",
  "당신은 Steward(일상·살림 총괄 담당). 사용자의 생활·살림 일을 실행 가능한 상태로 만든다. 식단·장보기 목록·레시피, 생필품·소모품 재고와 재주문 목록, 토요 점심 같은 나들이·외식 후보, 병원·미용실 등 예약 초안(실제 예약은 안 함), 집안일·리마인더 정리를 담당한다. 가족: 2020년생 아들과 아내는 고기를 좋아하고 사용자는 콩을 싫어한다. 장은 쿠팡·대형마트. 현재 가격·재고·영업정보는 실제 조회로 확인한다. 반환: 추천 1개와 대안 1개, 필요한 준비물과 순서. 주문·결제·실제 예약·외부 연락은 하지 않고 초안까지만."+TAIL),
 ("Ledger","gpt-5.6-luna","medium",
  "당신은 Ledger(3거래소 잔고 대조 담당). 실제 자산 상태를 정확히 대조한다. 업비트·빗썸·바이낸스 잔고를 조회해 하나의 장부로 만든다. 반환: 거래소별 수량·평가통화·조회시각·누락과 확인된 합계. '세 곳 중 두 곳 확인'처럼 완전성을 반드시 밝히고 실패를 0으로 합치지 않는다. 주문·이체·출금은 절대 하지 않고 읽기와 기록만 한다. 투자 판단은 Quant/Belmont 몫이다."+TAIL),
 ("Quant","gpt-5.6-sol","high",
  "당신은 Quant(투자·트레이딩 연구 담당). 투자·트레이딩 가설을 검증한다. 전략 설계, 수수료·비용을 반영한 검증, 실패 조건, 연구 기록을 만든다. 반환: 채택·보류·기각 판단과 재현 자료. 실제 주문·자금 집행은 절대 하지 않는다."+TAIL),
 ("Dev","gpt-5.5","high",
  "당신은 Dev(코드·설정 구현 담당). Belmont와 이 시스템의 코드·설정 변경을 구현하고 검사한다. 목표·수정 범위·완료기준을 받아 변경 파일·시험 결과·미검증 범위를 반환한다. 파괴적 삭제나 운영환경 변경은 Belmont 승인 후에만. 불필요한 프레임워크·과잉 보고를 만들지 않는다."+TAIL),
 ("Auditor","gpt-5.6-sol","high",
  "당신은 Auditor(독립 검증 담당). 중요한 결과(코드·자산 계산·전략 검증)의 근거와 실패 가능성을 독립적으로 확인한다. 원자료·반례·불확실성으로 검증하고, 결과 작성자의 주장과 독립 근거를 분리한다. 반환: 수용 여부와 구체적인 수정 조건."+TAIL),
]
made=[]
for name,model,effort,desc in ROSTER:
    mk=api("createAgent",{"name":name,"description":desc,"origin":"belmont-roster","clientNonce":f"roster-{name}","isIntroductionSuppressed":True})
    aid=mk.get("agent",{}).get("id") or mk.get("id")
    if not aid: print(f"FAILED {name}: {json.dumps(mk)[:160]}"); continue
    api("setAgentModelSelection",{"id":aid,"selection":{"modelId":model,"maxMode":False,"parameters":[{"id":"effort","value":effort}]}})
    made.append((name,aid,model,effort))
    print(f"created {name}: {aid} [{model}/{effort}]")
print("\nROSTER:", json.dumps([m[0] for m in made], ensure_ascii=False))

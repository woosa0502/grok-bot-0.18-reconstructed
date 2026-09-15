# Aside · Grok Bot 자율 워크플로우 실사례 모음 (2026-09-13)

목표·자율 실행·멀티에이전트·봇 세팅 중심으로, **출처 URL이 확인된 실제 사례만** 수집했다. 총 **138건** / 20개 카테고리. 조사원 6명이 병렬로 공식 사이트·docs·X·해커뉴스·Indie Hackers·유튜브·서브스택·GitHub·한국 커뮤니티를 조사(막힌 사이트는 insane-search 우회).

## 먼저 알아둘 것 (정직한 전제)

- **Grok Bot 은 실존 제품이다.** xAI(현 SpaceXAI LLC)가 2026-08-11 출시. 봇이 봇을 생성, 그룹채팅에서 업무 인계, Chief of Staff 봇이 지휘하는 구조가 공식 문서에 명시돼 있고, 공식 마켓플레이스에 봇 청사진 69개(제작자 43명)가 올라와 있다. 사용자가 본 커뮤니티 글은 과장이 아니다.
- **Aside 는 나온 지 며칠이라 커뮤니티 흔적이 얇다.** 사례 대부분이 공식 블로그의 역할별 실무 예시(연구·인사·운영·개발·영업)이고, 실제 지시문·결과가 그대로 적혀 있어 근거는 강한 편이나 제3자의 장시간 자율 실행 검증기는 드물다. 한국인 창업팀 제품이라 클리앙·브런치·gpters 에 1인칭 사용기가 오히려 더 많다.
- **신뢰도 구분**: 공식 문서/페이지 = 재현 가능한 기능. 유저 트윗·후기의 성과 수치($80K, $100K 절감 등) = 자가 보고, 미검증. 아래 표기의 `official/docs/review`는 근거가 강하고, `x-user/forum/blog`는 1인칭 주장이다.
- **환경 한계**: 레딧·디스코드는 이 환경에서 전량 차단돼 못 읽었다. 대신 Indie Hackers 포럼이 1인칭 멀티에이전트 구축기의 가장 풍부한 출처였다.

## 요약

| 카테고리 | 건수 |
|---|---:|
| 멀티에이전트 조직 (팀 편성·병렬 실행) | 19 |
| 봇이 봇을 생성 | 4 |
| 비서실장·보고 체계 | 7 |
| 에이전트 회의·그룹채팅 협업 | 4 |
| 목표 → 계획 → 실행 | 2 |
| 리서치 하네스 | 9 |
| 이메일 아웃리치·팔로우업·리마인드 | 5 |
| 영업 파이프라인 | 2 |
| SNS 자동화 | 7 |
| 채용 | 6 |
| 재무·트레이딩·회계 | 13 |
| 전자상거래·구매·협상 | 4 |
| 데이터 모니터링·감시 | 8 |
| 콘텐츠 제작 파이프라인 | 3 |
| 코딩·개발·운영 | 6 |
| SaaS 백오피스·감사 | 8 |
| 일정·루틴 자동화 | 11 |
| 고객지원 | 2 |
| 템플릿·마켓플레이스 | 1 |
| 개인 비서·일상 위임 | 17 |
| **합계** | **138** |

| 제품 | 건수 |  | 출처 유형 | 건수 |
|---|---:|---|---|---:|
| Grok Bot | 80 |  | official | 29 |
| Aside | 36 |  | youtube | 19 |
| 일반 에이전트 | 20 |  | forum | 19 |
| Manus | 1 |  | x-user | 17 |
| Genspark | 1 |  | blog | 11 |
|  |  |  | substack | 6 |
|  |  |  | marketplace | 5 |
|  |  |  | x | 5 |
|  |  |  | geeknews | 5 |
|  |  |  | github | 4 |
|  |  |  | docs | 3 |
|  |  |  | hn | 2 |
|  |  |  | x-founder | 2 |
|  |  |  | community | 2 |
|  |  |  | review | 1 |
|  |  |  | medium | 1 |
|  |  |  | devpost | 1 |
|  |  |  | press | 1 |
|  |  |  | x-official | 1 |
|  |  |  | clien | 1 |
|  |  |  | threads-kr | 1 |
|  |  |  | dc | 1 |
|  |  |  | x-kr | 1 |

## 멀티에이전트 조직 (팀 편성·병렬 실행) (19)

1. **Chief-of-staff bot delegates to specialist Grok bots** · `Grok Bot` · `youtube`  
   Main bot checks who owns a task, delegates, brings the finished result back to the user. Creator's live personal Grok Bot team (Klaus + Motion/Eyes/Minor).  
   [출처](https://www.youtube.com/watch?v=TMPUUyQC5aM) — "Before doing any task, check whether another Grok bot owns it and delegate first. Only do the work yourself if no specialist fits."
2. **Whole bot team runs its own daily stand-up** · `Grok Bot` · `youtube`  
   All bots in a group chat each other every morning about priorities and blockers, logged with no human present. Bot team group with a stand-up routine triggered by the chief of staff.  
   [출처](https://www.youtube.com/watch?v=0fyVaDintWQ) — "every morning my bots will have this conversation with each other about what they're doing this day and what their priorities are"
3. **Chief-of-staff bot pairs a researcher and a writer bot** · `Grok Bot` · `youtube`  
   Third bot orchestrates two specialists to finish a project together with no user intervention. Real user (Matt Schumer) quoted on the same podcast.  
   [출처](https://www.youtube.com/watch?v=kckD1hgkYvk) — "I set up a researcher bot and a writer bot, then made a chief of staff bot, and asked it to get the other two working together... It worked out of the box."
4. **One chief-of-staff bot runs three unrelated projects at once** · `Grok Bot` · `youtube`  
   Single bot manages a learning tracker, content-strategy review and catalog review in parallel under a no-contact rule. Live install-and-first-run walkthrough.  
   [출처](https://www.youtube.com/watch?v=YMBSVt3IOTI) — "Hard rails, never send messages or contact subscribers or partners without explicit approval."
5. **Grok Bot official: always-on multi-agent team** · `Grok Bot` · `official`  
   Bots run in parallel, message each other, pass task ownership. Persistent named Bots with memory, routines, cloud computer.  
   [출처](https://docs.x.ai/grok-bot/overview) — "Bots coordinate with each other. Your Bots can run in parallel, message each other, share context in group chats, and pass ownership of a task."
6. **Official guide details the same 8-Bot org chart** · `Grok Bot` · `official`  
   EM Bot decomposes and verifies; ICs each run their own cloud subagents. Named roles: Emily(EM), 5 engineers, Ashley(analytics), Pete(PM).  
   [출처](https://x.ai/bot/guides/grok-bot-for-pms) — "Eng mgr (Emily): does not code. Breaks work down, delegates to IC eng agents, checks the output against the goal."
7. **4-brand portfolio run by 13 Bots with a reporting chain** · `Grok Bot` · `x`  
   Each product's Head Bot runs the roadmap and reports weekly to one Chief Bot. Per brand: Chief+Head+Growth+Maintainer Bot, 4 brands.  
   [출처](https://x.com/CasJam/status/2093762642867581359) — "A Head bot: Manages product roadmap, orchestrates feature dev, weekly reporting to Chief, and takes inbound directions from me and Chief."
8. **7-Bot setup honestly reports a real limit: bots can't delegate to each other** · `Grok Bot` · `blog`  
   Seven named Bots each own a domain but cannot call each other's skills. Social Writer, CoS, invoicing, researcher, SEO, creative director, coach.  
   [출처](https://genaiunplugged.substack.com/p/grok-bot-hands-every-agent-the-same) — "An SEO skill cannot be reached from the social manager."
9. **Open-source "second brain" plan, deliberately capped at 5** · `Grok Bot` · `github`  
   Conductor Bot assigns; 4 specialists each own a GTD-pipeline stage. Conductor, Capture, Memory, Ops, Research Bot sharing one vault.  
   [출처](https://github.com/mKay00/grok-bot-second-brain) — "Five is the point. A 26-bot roster is the thing this plan refuses."
10. **Open-source "50-Bot revenue fleet" blueprint (YAML contracts)** · `Grok Bot` · `github`  
   4-tier Bot org defined by YAML role-contracts; money moves need dual sign-off. Orchestration/reasoning/growth/revenue tiers, target 50 Bots.  
   [출처](https://github.com/AgentMindCloud/Grokbot-Autonomous-Revenue) — "Dual sign-off for money. Separate wallets. No private keys in shared sessions."
11. **"Grok Factory" repo: all instructions route through one dispatcher Bot** · `Grok Bot` · `github`  
   User talks only to a "Firstmate" Bot that distributes work to scanner/research/dev Bots. Firstmate + Scanner + Name Researcher + Project Crewmate.  
   [출처](https://github.com/jaredtrichard/grok-factory) — "After install, talk only to Firstmate."
12. **A non-dev sets up a company and hands the CEO seat to a Bot** · `Grok Bot` · `forum`  
   Founder stands up a site in a day with a small Bot team, then "humans read, bots write". 1 human + small Bot team; new Bots publish after a signup gate.  
   [출처](https://forum.cursor.com/t/grokularity-a-company-run-by-grok-bots/169471) — "DoorDashed for SuperGrok, stood up a company in a day, handed CEO to a Grok Bot."
13. **Manus "Wide Research": one goal into hundreds of subagents** · `Manus` · `official`  
   Main agent splits the request into independent subtasks, subagents run in parallel, main merges. Main agent + up to 250-item subagent fan-out.  
   [출처](https://manus.im/docs/features/wide-research) — "The main agent analyzes your request and breaks it into independent sub-tasks... assembles them"
14. **AI-buddies spin up personalities that talk to each other** · `일반 에이전트` · `hn`  
   Always-on personal agents each with a role, sharing info, pulling input from real people. Built on Screenpipe's 24/7 local screen/mic capture as shared context.  
   [출처](https://news.ycombinator.com/item?id=49037707) — "quickly spin up 'buddies' who have varying personalities... buddies can talk to each other, share information"
15. **Agents ask each other for help, no boss agent** · `일반 에이전트` · `forum`  
   Peers broadcast unmet requests, specialized agents answer, credits track the exchange. Lightweight relay network, no central orchestrator.  
   [출처](https://www.indiehackers.com/post/i-built-a-network-where-ai-agents-help-each-other-heres-what-i-learned-a5cc722296) — "No central orchestrator — agents negotiate directly"
16. **Design lesson: one job per bot** · `Grok Bot` · `x-user`  
   A bot given two jobs broke, establishing single-responsibility multi-agent design. Observation from running several single-purpose bots.  
   [출처](https://x.com/PrajwalTomar_/status/2092227511459758230) — "give every bot ONE job. The moment I gave a bot two jobs, it got..."
17. **그록봇, 역할별 GTM Bot 팀+비서실장 봇 구성** · `Grok Bot` · `geeknews`  
   리서치·아웃바운드·예측·인박스·슬라이드 담당 봇에 업무 배분하는 비서실장 봇. Eric Zakariasson의 100개 활용사례를 긱뉴스가 요약.  
   [출처](https://news.hada.io/topic?id=32432) — "리서치/아웃바운드/예측/인박스/슬라이드를 각각 맡는 GTM Bot 팀 구성, 여러 전문 Bot에 일을 배분하는 Chief of Staff Bot"
18. **그록봇 6대로 뉴스레터 리서치~발송 전체 자동화** · `Grok Bot` · `blog`  
   리서치·편집·광고영업·발송까지 여섯 봇 역할 분담해 주간 뉴스레터 원맨 운영. 6천명 구독 The Arlington Bagel 운영자 사례 소개.  
   [출처](https://news.aikoreacommunity.com/grokbot-newsletter-automation-5-cases/) — "리서치, 편집, 광고 영업, 발송까지 여섯 대의 그록봇 에이전트로 어떻게 굴리고 있는지"
19. **X(KR): 그록 4.2 네 개 에이전트 협업 구조** · `Grok Bot` · `x-kr`  
   캡틴·리서치·수학코드·창의 네 전문 에이전트가 복잡한 질의마다 자동 협업. Grok 4.20 멀티에이전트 아키텍처 한국어 소개.  
   [출처](https://x.com/HoneyJamTesla/status/2023842992310939735) — "네 가지 에이전트... 충분히 복잡한 모든 쿼리에서 실행되는 네이티브 프로덕션 멀티 에이전트 협업 시스템을 구성"

## 봇이 봇을 생성 (4)

20. **Official docs: a Bot can create a new Bot** · `Grok Bot` · `official`  
   Existing Bot suggests/creates a focused Bot when a job needs a long-lived owner. Human approval assumed; docs advise keeping roster small.  
   [출처](https://docs.x.ai/grok-bot/bots) — "Your existing Bots can also suggest or create a focused Bot when a job should have a long-lived owner."
21. **"dr eggbot": a marketplace Bot that designs/creates other Bots** · `Grok Bot` · `marketplace`  
   Asks preference questions then creates a new Bot via CreateAgent. Single specialist Bot by a Grok Bot team member.  
   [출처](https://x.ai/bot/_jOdbfkB16zxu7MRcmReE) — "Designs high-quality Grok Bots. Asks a few preference questions, then creates them with CreateAgent."
22. **Life/Work split structure where parent Bots create child Bots** · `Grok Bot` · `x`  
   Two domain Bots spin up new channels and specialist child bots for incoming work. Life Bot / Work Bot; ambiguous tasks default to Life.  
   [출처](https://x.com/TylerNishida/status/2093426221732532457) — "these bots will create new channels and specialist bots under them to complete tasks."
23. **User makes one Bot a "CTO" that hires child Bots** · `Grok Bot` · `youtube`  
   Parent acts as accountable agent, spawns a child Bot per subsystem it owns. CTO Bot + child bots for PRs, DB, auth.  
   [출처](https://www.youtube.com/watch?v=kAR91DlnCKQ) — "title "I Turned Grok Bot Into My CTO"; "hires child bots for PRs, Convex, and auth"

## 비서실장·보고 체계 (7)

24. **User runs a weekly self-audit routine across all bots** · `Grok Bot` · `x`  
   Chief of Staff Bot reviews every bot's activity weekly and recommends adds/improvements. One CoS Bot supervising a personal roster, runs 8am weekly.  
   [출처](https://x.com/mikepat711/status/2092997808127172910) — "Chief of Staff Grok Bot running a weekly routine at 8am, where it looks at all of my activity across all bots, and gives me recommendations"
25. **Shared prompt turns a Bot into a time-management coordinator** · `Grok Bot` · `x`  
   User-written charter keeps three priorities moving and prevents dropped balls. One CoS Bot prompt, shared publicly for copy-paste.  
   [출처](https://x.com/coreyganim/status/2092375719292862933) — "You are [Name]'s Chief of Staff. Your job is to protect their time, keep their three priorities moving, and make sure nothing important falls through."
26. **Open-source local Chief-of-Staff template, 7 specialists** · `Grok Bot` · `github`  
   CoS decides per request whether to answer directly or call a narrow specialist. CoS + briefing/priority/comms/calendar/research/decision/follow-up Bots.  
   [출처](https://github.com/Scubasteve1999/chief-of-staff-grok) — "Chief decides "when a specialist is worth the extra call. Simple asks stay on the CoS desk."
27. **Chief-of-Staff bot with written charter + 5 daily routines** · `Grok Bot` · `x-user`  
   One manager bot coordinates others via charter; brief-execute-review-handoff cadence. Custom CoS persona with explicit human-in-loop reporting line.  
   [출처](https://x.com/kocer_eth/status/2092216029816472002) — "the charter, 10 rules and 5 routines I run" / "brief at 7, execute, review at 4, handoff at 6, sleep"
28. **Reusable prompt to build a Chief-of-Staff bot** · `Grok Bot` · `x-user`  
   Shareable persona-prompt turns a bot into a delegating, priority-protecting manager. Prompt pasted as the bot's description, nothing else configured.  
   [출처](https://x.com/coreyganim/status/2092375719292862933) — "You are [Name]'s Chief of Staff. Your job is to protect their time, keep their three priorities moving..."
29. **그록봇: 비서실장 봇에게만 지시하면 끝** · `Grok Bot` · `geeknews`  
   여러 전문 봇 대신 비서실장 봇 하나에 지시하면 업무를 알아서 조정·전달. xAI 그록봇 UX 설계 원칙을 긱뉴스가 번역·정리.  
   [출처](https://news.hada.io/topic?id=33343) — "일부 사용자는 Chief of Staff Bot에 여러 전문 Bot의 조정을 맡김…하나의 Bot에 지시할 수 있음"
30. **브런치: 그록봇 AX 설계 분석, 비서실장 구조 정리** · `Grok Bot` · `blog`  
   24시간 클라우드 봇+실제 앱 로그인 조작+비서실장 구조를 5축 분석. 그록봇 활용사례 공유 오픈카톡방 운영 디자이너.  
   [출처](https://brunch.co.kr/@ghidesigner/532) — "감독 없이 여러 단계의 업무를 끝내는 상시 가동 에이전트 팀이라는 개념이다"

## 에이전트 회의·그룹채팅 협업 (4)

31. **Official docs recommend group chat to make handoffs visible** · `Grok Bot` · `official`  
   Multiple named Bots share one thread so a human can watch the handoff. Example: launch coordinator, content editor, analytics reviewer Bots.  
   [출처](https://docs.x.ai/grok-bot/bots) — "Put Bots in a group chat when the handoff itself needs to be visible..."
32. **Official blog describes live cross-functional Bot "meeting"** · `Grok Bot` · `official`  
   Designer, engineer, PM, data-scientist Bots work in one room and hand work to each other. 4 role Bots in one shared thread.  
   [출처](https://x.ai/news/designing-grok-bot) — "A designer, engineer, PM, and data scientist can work in the same conversation, hand work to one another, and share what the project requires."
33. **Group-chat manager bot delegates to a bot team** · `Grok Bot` · `x-user`  
   One appointed manager bot routes tasks to specialist bots in a shared chat, reports back. Several Grok Bots in one group chat with a manager appointed.  
   [출처](https://x.com/PrajwalTomar_/status/2091533452642525663) — "You put your bots in one group chat, appoint a manager, and stop being the router between your own tools"
34. **그록봇 그룹채팅서 디자이너·PM 봇 협업** · `Grok Bot` · `geeknews`  
   디자이너·엔지니어·PM·데이터과학자 봇이 그룹채팅에서 작업 인계·정보공유. 계정당 봇 50개, 그룹채팅당 봇 6개 제한 설계.  
   [출처](https://news.hada.io/topic?id=33343) — "디자이너, 엔지니어, PM, 데이터 과학자 역할의 Bot이 같은 대화에서 협업하고 작업을 넘기며 필요한 정보를 공유"

## 목표 → 계획 → 실행 (2)

35. **PM user's core team decomposes a goal and delegates** · `Grok Bot` · `x`  
   Eng-manager Bot breaks the goal into pieces, delegates to 5 IC Bots, checks output vs goal. Chief of Staff, EM, 5 IC engineers, data analyst, PM Bot.  
   [출처](https://x.com/n2parko/status/2087251704744235298) — "eng mgr: breaks down eng work and delegates to..."
36. **Threads: "지원자 찾아 면접노트 정리해줘" 한 줄이면 끝** · `Aside` · `threads-kr`  
   자연어 목표 한 줄이면 브라우저가 여러 사이트 오가며 작업 끝내고 결과만 반환. 한국인 개발자가 만든 Aside, 주소창 옆 AI 지시창.  
   [출처](https://www.threads.com/@unclejobs.ai/post/DZ9F4_sCeRV) — "어제 열어본 지원자 찾아서 면접 노트 정리해줘 같은 걸 적으면, 브라우저가 알아서 사이트를 오가며 일을 끝내고 결과만 가져옵니다"

## 리서치 하네스 (9)

37. **Verify every source link cited in a research brief** · `Aside` · `official`  
   Opens each link unattended, screenshots the page, compares it to the claim, labels status itself. Ultrabrowse mode, per-link screenshot capture, four-way verification status output.  
   [출처](https://aside.com/blog/researchers) — "Open each link, capture a screenshot, compare the current page against the claim in the brief, and mark claims as verified, changed, missing, or needs human review."
38. **Download, rename and extract data from dozens of PDFs** · `Aside` · `official`  
   Signs into a database, downloads every PDF, renames files, extracts fields into one sheet. Login handling, filename convention, structured spreadsheet output across many docs.  
   [출처](https://aside.com/blog/researchers) — "Open the database results page, sign in if needed, download the PDFs, and rename each file as first-author-year-short-title.pdf."
39. **Research NY Tech Week attendees matching an ICP** · `Aside` · `docs`  
   Long-horizon Ultrabrowse job: researches companies, identifies contacts, cites every source. Ultrabrowse reasoning mode, source-heavy multi-page comparison, contact recommendation output.  
   [출처](https://docs.aside.com/help/ultrabrowse.md) — "Research companies attending NY Tech Week that match our ICP. Identify Sales VPs or revenue leaders, cite the pages you use, and recommend who to contact first."
40. **Routine researches each day's sales prospects before calls** · `Grok Bot` · `youtube`  
   Bot checks the calendar, finds scheduled calls, researches each prospect, delivers a briefing unprompted. Pre-call prospect-research routine.  
   [출처](https://www.youtube.com/watch?v=0fyVaDintWQ) — "it will actually go and look at my calendar for the day and check out whether there are any sales calls planned on that day"
41. **"Researchy": research desk that bans cheap/offline answers** · `Grok Bot` · `marketplace`  
   Forces every research/fact-check through a top reasoning model + live web search. One specialist Bot by community maker.  
   [출처](https://x.ai/bot/marketplace/bots/researchy) — "never uses a training-only pass, never Sonnet or a clerk model"
42. **Agent left unattended on reverse-engineering tasks** · `일반 에이전트` · `hn`  
   Goal given, agent searches/explores autonomously, human verifies compact result later. No framework named; system-optimization / reverse-engineering.  
   [출처](https://news.ycombinator.com/item?id=49653399) — "for certain kinds of reverse engineering or system optimization problems it's helpful"
43. **Scout Agent hunts Reddit weekly for pain points** · `일반 에이전트` · `forum`  
   Sunday-only agent scans 13 subreddits, ranks complaints, drafts responses. Same 13-agent stack; ranks by frequency, willingness to pay, API availability.  
   [출처](https://www.indiehackers.com/post/i-replaced-my-morning-routine-with-13-ai-agents-heres-what-they-do-b18ca8b97b) — "Scout agent scans Reddit every Sunday for validated problems... searches 13 subreddits for patterns like 'wish there was a tool'"
44. **Standing agent mines Reddit/X for validated startup ideas** · `Grok Bot` · `x-user`  
   Agent continuously watches two platforms, scores complaints, surfaces only strong signals. One Grok Bot left running, reports only when signal crosses a threshold.  
   [출처](https://x.com/0xChaseTM/status/2092589881780232468) — "How I Built a 24/7 Agent That Turns Reddit and X Into Product Ideas"
45. **Multi-agent system writes/maintains an encyclopedia live** · `Grok Bot` · `x-user`  
   Agent team continuously writes, updates and cross-checks articles against a live KB. Grok multi-agent system + Grokipedia feedback loop.  
   [출처](https://x.com/MarioNawfal/status/2025401407164350513) — "Grok 4.20's multi-agent system now powers Grokipedia in real time. Grok writes, updates, and perfects entries instantly"

## 이메일 아웃리치·팔로우업·리마인드 (5)

46. **Draft sourced follow-up emails after every sales call** · `Aside` · `official`  
   Pulls transcript, CRM history and buyer's site per account, stages one draft email each. Per-account follow-up drafting, evidence-linked emails, held for approval before sending.  
   [출처](https://aside.com/blog/sales) — "For each account, stage a draft email with the buyer quote, proof URL, CRM note link, and suggested next step."
47. **Official marketplace Bots draft overnight outreach/follow-up** · `Grok Bot` · `marketplace`  
   Research accounts overnight, draft first-touch and follow-up, leave morning approval queue. Sales Outbound, Signal Prospector, Call Follow-Ups Bot (official listing).  
   [출처](https://x.ai/bot/marketplace/sales) — "Researches accounts overnight... drafts email and LinkedIn in your voice, and leaves a review list for you to approve."
48. **Seller Agent delivers ready-to-send cold emails** · `일반 에이전트` · `forum`  
   3x/week agent finds leads and writes copy-paste cold outreach with no review step. Mon/Wed/Fri 2pm inside the same multi-agent Notion-logged stack.  
   [출처](https://www.indiehackers.com/post/i-replaced-my-morning-routine-with-13-ai-agents-heres-what-they-do-b18ca8b97b) — "Seller agent delivers 4 to 5 qualified leads with copy-paste cold emails."
49. **Agent closes a $10,000 sponsorship deal unsupervised** · `Grok Bot` · `x-user`  
   Agent researched rates, emailed, negotiated price and closed a real deal with zero human turns. Bot given business email + negotiation access for one deal.  
   [출처](https://x.com/EvanLuthra/status/2091227264260378735) — "closed a $10,000 sponsorship deal... researched the right rates, replied to the emails, negotiated the price and closed the deal" (self-reported)"
50. **그록봇, 베트남 원단업체 40곳 협상 무감독 완료** · `Grok Bot` · `geeknews`  
   봇 하나가 40개 공급업체 연락·가격협상·업체선정·샘플제작까지 자동 처리. 한 달간 그록봇 쓴 HN 유저 사례를 긱뉴스가 한국어로 요약.  
   [출처](https://news.hada.io/topic?id=32432) — "베트남의 원단 공급업체 약 40곳에 연락해 가격을 협상하고 업체를 선정한 뒤 샘플 제작까지 진행"

## 영업 파이프라인 (2)

51. **Build a sourced call brief before a discovery meeting** · `Aside` · `official`  
   Opens CRM, prospect site, LinkedIn and a past deal deck, synthesizes a brief unattended. Six-source research sweep, screenshots pages likely to change, five suggested questions.  
   [출처](https://aside.com/blog/sales) — "Open the CRM account, call notes, website, pricing page, security page, LinkedIn company page, open roles, and the deck from the closest past deal. Give me a call brief..."
52. **Enterprise GTM sales team run as a Bot org** · `Grok Bot` · `blog`  
   CoS orchestrates; overnight outreach drafts pile into a morning review queue. CoS, prospecting, per-account specialist, forecasting, slides, sales-coach Bots.  
   [출처](https://thegtmnewsletter.substack.com/p/grok-bot-gtm-teams-setup-use-cases) — "orchestrates the rest of the team" / "tell your bot to spin up multiple cloud agents for parallel tasks"

## SNS 자동화 (7)

53. **Summarize hundreds of X posts on a topic from a logged-in account** · `Grok Bot` · `review`  
   Browses logged-in X, searches a topic, filters hundreds of posts/replies into one summary. Logged-in social-session browsing, large-scale post filtering, structured output writing.  
   [출처](https://www.eesel.ai/blog/aside-ai-browser) — "Aside browsed logged-in X, searched a topic, filtered hundreds of posts/replies, and turned the results into a structured summary."
54. **Saved login lets a routine like posts on a schedule** · `Grok Bot` · `youtube`  
   Bot reuses a saved browser session on a community site and repeats an engagement task weekly, unattended. Creator teaches the bot his Skool login, sets a recurring routine.  
   [출처](https://www.youtube.com/watch?v=TMPUUyQC5aM) — "it watched me go through find posts and like them, and now I can set that up on a routine to do that every day or every week"
55. **Seven-bot team drafts and schedules posts live, no laptop** · `Grok Bot` · `substack`  
   Social writer, SEO, researcher bots run in parallel; two posts written and queued to a publishing tool from one phone chat. Hour-long live walkthrough of a real bot team.  
   [출처](https://genaiunplugged.substack.com/p/grok-bot-hands-every-agent-the-same) — "He wrote a Substack note and a LinkedIn post on air and pushed both into Typefully from the same chat window."
56. **X account runs itself on 20+ daily scheduled tasks** · `일반 에이전트` · `forum`  
   Posts 3x/day, checks mentions, auto-replies, rewrites its own growth strategy nightly. 5-week-old stack behind a real X account, tracks own performance.  
   [출처](https://www.indiehackers.com/post/i-analyzed-7-autonomous-ai-agents-for-business-in-2026-here-s-what-i-concluded-e34c50741f) — "20+ scheduled tasks running daily: morning/midday/evening posts, mention checks, auto replies, nightly strategy generation"
57. **Agent DMs 200 prospects a day while founder sleeps** · `일반 에이전트` · `forum`  
   Agent profiles prospects, personalizes DMs, tracks replies, retunes messaging on its own. Continuous Instagram outreach loop (quoted in a roundup; secondhand).  
   [출처](https://www.indiehackers.com/post/5-ai-agent-workflows-actually-making-money-in-2026-with-real-numbers-ea266790ba) — "the agent does 200 outreach messages a day while I sleep. My close rate actually went up"
58. **One bot runs three X accounts to 69.8M impressions** · `Grok Bot` · `x-user`  
   Single agent handles ideation, posting and replies across three accounts unattended. Two operators route all content/engagement through one bot.  
   [출처](https://x.com/PrajwalTomar_/status/2091925033421865460) — "one Grok Bot run 3 X accounts at once... 69.8M impressions" (self-reported)"
59. **브런치: Aside로 카카오 로그인·캡차 우회 자동 포스팅** · `Aside` · `blog`  
   Playwright로 막혔던 카카오 로그인·캡차를 Aside 세션으로 우회해 자동 포스팅. 1년간 API 없는 사이트 자동화 실패 후 Aside 도입.  
   [출처](https://brunch.co.kr/@sukistory/133) — "처음에는 클로드코드 > Playwright로 컨텐츠 포스팅을 시켜봤습니다. 잘 돌다가 카카오 로그인 창에서 멈춰요"

## 채용 (6)

60. **Assemble a full evidence packet before final interviews** · `Aside` · `official`  
   Opens ATS, calendar, LinkedIn, portfolio and docs across many tabs, compiles one packet. Cross-tool packet build spanning ATS, LinkedIn, GitHub, portfolio, calendar.  
   [출처](https://aside.com/blog/hr) — "Open each ATS profile, scorecard, resume, LinkedIn page, portfolio, and calendar event. Capture missing scorecards or changed portfolio pages, build a packet with source links"
61. **Chase missing paperwork, then resume the task days later** · `Aside` · `official`  
   Sends approved message, idles three days, wakes itself and reopens task on reply. Approval-gated outbound message plus multi-day wait-then-resume task loop.  
   [출처](https://aside.com/blog/hr) — "Stage a reminder to candidates missing work authorization details. After I approve the message, wait for replies for three days, reopen this task when someone responds"
62. **Marketplace recruiting Bot: auto scheduling/prep, always human-approved sends** · `Grok Bot` · `marketplace`  
   Automates interview scheduling, prep, stuck-item tracking; never sends without approval. Scoped to one recruiter, calendar/candidate-list inputs.  
   [출처](https://x.ai/bot/marketplace/bots/mr-toms) — "never emails a candidate without you" / "Never sends, book, post, or reject without your yes."
63. **Hackathon project: 5 agents connect a full hiring funnel** · `Grok Bot` · `devpost`  
   Position creation, interview, extraction, team/interviewer matching handled in sequence. Position Creator, AI Interviewer, Info Extractor, Team Matcher, Interviewer Matcher.  
   [출처](https://devpost.com/software/grokrecruiter) — "an AI recruiting platform that automates screening and matches candidates to teams using a knowledge graph"
64. **Genspark Claw launches as "first AI employee"** · `Genspark` · `press`  
   User delegates via one message; agent runs multi-step work across apps and returns result. Per-user dedicated cloud computer with Claw preinstalled.  
   [출처](https://www.businesswire.com/news/home/20260312641003/en/Genspark-Claw-Launches) — "Genspark Claw allows users to delegate work via a simple message, execute multi-step tasks across software, and return the finished result."
65. **Always-on job-hunting agent applies to 20 roles/day** · `Grok Bot` · `x-user`  
   Agent autonomously tailors resumes and submits applications daily. Given accounts, resume, and a single demo of the process.  
   [출처](https://x.com/bigaiguy/status/2090380834536878140) — "use Grok Bot as an always-on job hunter that applies to 20 roles a day with tailored resumes"

## 재무·트레이딩·회계 (13)

66. **Collect and rename every vendor invoice at month-end** · `Aside` · `official`  
   Logs into each vendor portal, downloads PDFs, renames by convention, logs access failures. Vendor-portal login sweep, filename convention, exception log for blocked portals.  
   [출처](https://aside.com/blog/operations) — "vendor-YYYY-MM.pdf files"
67. **Prepare a vendor payment for a human to approve** · `Aside` · `official`  
   Pulls invoice, checks portal, validates discount, reviews contract, stages note, then stops. Multi-source validation with a support-chat fallback, stops short of paying.  
   [출처](https://aside.com/blog/operations) — "staged payment note with source links"
68. **Pre-screen large purchase requests before an approval decision** · `Aside` · `official`  
   Cross-checks every request over a set dollar threshold against inventory and vendor records. Threshold-triggered review, SaaS inventory cross-reference, human keeps final call.  
   [출처](https://aside.com/blog/operations) — "For each request over $5,000, check whether the vendor exists in the SaaS inventory, find the likely owner, and stage a short approval note."
69. **Audit expense reports against the written travel policy** · `Aside` · `docs`  
   Cross-checks a receipt spreadsheet against policy text and flags line items needing action. Ultrabrowse reasoning mode, policy-to-spreadsheet cross-check, per-line policy citations.  
   [출처](https://docs.aside.com/help/ultrabrowse.md) — "Review our travel expense policy and the receipt spreadsheet. Flag reimbursements that need a note, category fix, or manager approval. Cite the policy sections you use."
70. **Aside agent completes a live Chase credit-card task** · `Aside` · `youtube`  
   Works inside a logged-in bank account, edits a flow, keeps password entry in sidebar, runs a parallel subtask. Frame-by-frame breakdown of Aside's own launch demo video.  
   [출처](https://www.youtube.com/watch?v=JMJ2DDsXsfI) — "The demo moves into a real browser task, editing or working through a Chase credit card flow, with memory files and a password entry visible in the sidebar."
71. **Marketing agency runs 12 desks under one coordinator** · `Grok Bot` · `blog`  
   1 human + 1 coordinator assign work to 12 specialist desks under codified allow/deny rules. Ops Coordinator + named IT/expense/EA desks (12).  
   [출처](https://dennisyu.com/how-i-use-grok-bot/) — "One human. One coordinator conversation. Specialists get a job when the coordinator (or I) assign it."
72. **IT desk performs and logs a real WordPress login recovery** · `Grok Bot` · `blog`  
   Limited-scope desk uses cloud key access to fix a server, no password exposure. IT-support desk under Quality dept, dated evidence.  
   [출처](https://dennisyu.com/how-i-use-grok-bot/) — "The public site stayed up" after reset; "password never posted"
73. **AI "CEO" runs everything except the checkbook** · `일반 에이전트` · `forum`  
   Full autonomy on content/product/support, zero autonomy on spend or irreversible calls. One operator's explicit autonomous vs human-gated split.  
   [출처](https://www.indiehackers.com/post/i-analyzed-7-autonomous-ai-agents-for-business-in-2026-here-s-what-i-concluded-e34c50741f) — "full autonomy on content, product, support; zero autonomy on spend above 0 or irreversible decisions"
74. **GrokStreet: 12-agent solo trading desk** · `Grok Bot` · `x-user`  
   Operator runs a persistent 12-agent desk with roles, dashboards, shared vault, unattended. Grok Bot agents on desks (research/risk/execution) running 24/7 from one laptop.  
   [출처](https://x.com/adiix_official/status/2092980659522355613) — "What started as a crazy experiment is becoming a real 12-agent AI trading desk"
75. **GrokStreet described by outside observer** · `Grok Bot` · `x-user`  
   11 Grok Bot desks run 24/7 unattended, state streamed remotely while laptop is shut. Mac running 11 agent desks, streamed to a phone over a private network.  
   [출처](https://x.com/RoundtableSpace/status/2093537875489087794) — "GrokStreet is a live pixel trading floor with eleven Grok Bot desks running 24/7 on a Mac"
76. **Six-agent floor replaces a whole trading team** · `Grok Bot` · `x-user`  
   Six role-specialized agents each own one job on one desk, no human traders. Grok Bot deployed as a desk of six specialized agents.  
   [출처](https://x.com/mikenevermiss/status/2091774757985255522) — "six AI agents sit on the desk, each handling a different job that would normally require a team of expensive professionals"
77. **8-agent crypto desk build tutorial** · `Grok Bot` · `x-user`  
   Step-by-step guide to deploying 8 autonomous Grok Bot agents as one crypto desk. Full tutorial for replicating an autonomous multi-agent desk.  
   [출처](https://x.com/ridark_eth/status/2091924787341766859) — "Grok Bot Trading Floor: how to run an 8-agent crypto desk in 10 Steps (Full-tutorial)"
78. **Meme-coin pipeline runs unattended overnight** · `Grok Bot` · `x-user`  
   Five single-purpose agents monitor pump.fun, score, and buy tokens continuously unsupervised. Cloud agent swarm, each doing one narrow scoring/buying job.  
   [출처](https://x.com/zostaff/status/2092608485393350733) — "I GAVE FIVE GROK BOTS $1,000 ON PUMPFUN AND WALKED AWAY..." (self-reported result, unverified)"

## 전자상거래·구매·협상 (4)

79. **Solo founder's AI-run company nears $500k/mo** · `일반 에이전트` · `forum`  
   Founder gives direction only; agents run marketing, support, ops, Stripe billing end to end. Guardrailed agents + shared memory; a blind spot missed 20+ Stripe disputes.  
   [출처](https://www.indiehackers.com/post/tech/growing-a-fully-autonomus-business-to-a-500k-mo-in-3-months-diZ8gkqMHm0CvEsc7Pfo) — "You bring the idea and direction, Polsia handles marketing, ops, support, and execution through AI agents."
80. **Official "Haggle Bot" procurement template saves $100K in a week** · `Grok Bot` · `x-official`  
   Pre-built agent negotiates vendor contracts, finds unused SaaS seats, price-checks continuously. Marketplace template installed as-is by xAI's own team.  
   [출처](https://x.com/bot/status/2095954887205138597) — "It negotiates vendor contracts, finds unused SaaS seats, and price-checks recurring purchases. One week in, it's saved us over $100K."
81. **Founder confirms autonomous purchasing + negotiation** · `Grok Bot` · `x-founder`  
   CEO-level statement that the agent independently sources and negotiates purchases. Official capability claim on the product's account.  
   [출처](https://x.com/elonmusk/status/2094491665335558361) — "Grok Bot will not only do your purchasing, but also find & negotiate the best deal"
82. **클리앙: Aside로 쇼핑몰 주문·송장 자동화** · `Aside` · `clien`  
   Aside가 쇼핑몰+이메일 주문 처리부터 송장 출력까지 브라우저 자동화로 연결. 수입차 딜러 CRM 자동화 개인 프로젝트 중 Aside 설치.  
   [출처](https://www.clien.net/service/board/park/19255205) — "각 쇼핑몰+이메일로 들어오는 주문들 처리부터 송장 출력 단계까지 훨씬 매끄럽게 이어지더군요"

## 데이터 모니터링·감시 (8)

83. **Check competitor pricing pages for changes weekly** · `Aside` · `official`  
   Revisits each pricing page on a recurring schedule, screenshots and flags what changed. Weekly repeatable routine, fixed comparison schema, sales-gated content flag.  
   [출처](https://aside.com/blog/researchers) — "Ask for a plan table, one screenshot per page, a sales-gated flag, and a last-checked date."
84. **Re-verify and propose fixes for 12 CRM accounts** · `Aside` · `official`  
   Rechecks each account's live website and LinkedIn page, proposes edits with confidence scores. Batch CRM verification, source-linked proposed edits, no automatic saves.  
   [출처](https://aside.com/blog/sales) — "Open the CRM records for these 12 accounts. For each one, check the latest website and LinkedIn page, propose company size and industry updates with source URLs..."
85. **New agent classifies receipts and files them to Sheets** · `Grok Bot` · `youtube`  
   Bot ingests photographed tickets, classifies them locally, Composio link pushes rows into Google Sheets. Creator replaces his old n8n workflow live in one take.  
   [출처](https://www.youtube.com/watch?v=VpljJqzPvg0) — "literal me van a ver haciéndola en menos de 5 minutos" (ticket-classification automation)"
86. **Routine rolls up followers across five platforms daily** · `Grok Bot` · `youtube`  
   Bot pulls subscriber counts from separate networks and writes a running total to one spreadsheet. Content-team bot group, routine set daily.  
   [출처](https://www.youtube.com/watch?v=0fyVaDintWQ) — "it pulls my YouTube subs, my YouTube views, Instagram, TikTok, Twitter, newsletter, and school"
87. **Morning routine grades yesterday's sales calls** · `Grok Bot` · `youtube`  
   Bot pulls call recordings, transcribes them, scores the rep against a named sales framework unattended. Sales-call review routine fed by Fathom recordings.  
   [출처](https://www.youtube.com/watch?v=0fyVaDintWQ) — "analyze those sales calls based on the transcript and give me a recap of what I've been doing well and what I can improve"
88. **On-call bot reacts to production incidents live** · `Grok Bot` · `substack`  
   Agent watches Datadog/PagerDuty, responds to incidents as they fire, writes its own follow-up monitoring routines. Same insider workshop recap.  
   [출처](https://mlearning.substack.com/p/grok-bot-inside-spacexais-agent-playbook) — "An on-call agent is created to monitor Datadog and PagerDuty, react to incidents and create its own monitoring routines."
89. **14 SaaS products get an unattended daily health check** · `일반 에이전트` · `forum`  
   Agents triage issues, review search console, flag traffic/conversion anomalies each morning. Propose-then-execute: agent queues, human approves, it runs.  
   [출처](https://www.indiehackers.com/post/how-i-run-14-saas-products-with-ai-agents-one-month-report-49075e9757) — "Check analytics for anomalies — traffic drops, conversion changes, broken tracking"
90. **Agent mines Reddit threads into a sales pipeline** · `일반 에이전트` · `forum`  
   Watches 15-20 subreddits for buying-intent language, classifies posts, queues cold email. Implied sub-agents (classifier, reply-drafter, sequencer) in one loop (secondhand).  
   [출처](https://www.indiehackers.com/post/5-ai-agent-workflows-actually-making-money-in-2026-with-real-numbers-ea266790ba) — "'I'm so frustrated with [competitor], does anyone know an alternative?' — that's a hot lead"

## 콘텐츠 제작 파이프라인 (3)

91. **Screen recording turned into a reusable bot skill** · `Grok Bot` · `youtube`  
   Agent watches a recorded demo, analyzes the actions, converts them into a skill it can rerun. Creator records himself doing an image-search task to teach the bot.  
   [출처](https://www.youtube.com/watch?v=TMPUUyQC5aM) — "learn from demonstration" (label after the recording is analyzed into a reusable skill)"
92. **Daily routine tracks competitor YouTube uploads into Notion** · `Grok Bot` · `youtube`  
   Bot scans a fixed channel list, pulls thumbnails and view baselines, files a formatted brief with no manual step. Creator's YouTube-strategy bot, running for weeks.  
   [출처](https://www.youtube.com/watch?v=0fyVaDintWQ) — "newest long-form videos from track channels with thumbnails, plus how each one is performing against its own channel baseline"
93. **One stack absorbs 28 of 40 marketing tasks** · `일반 에이전트` · `forum`  
   Agent polls inbox, scans HN/X/Bluesky, drafts 5 channel-ready posts, emails a nightly digest. Hard rule blocks any outbound send without a human click.  
   [출처](https://www.indiehackers.com/post/ai-runs-70-of-my-distribution-the-exact-stack-fda9c0d2c9) — "End-of-day script produces 5 ready-to-edit drafts across 5 channels using my founder voice doc"

## 코딩·개발·운영 (6)

94. **Support-bot receives a bug report and fixes the code itself** · `Grok Bot` · `youtube`  
   Agent takes an incoming bug ticket and edits the live codebase in its own cloud session, no human hand-off. Spanish creator demos his SaaS (Forja) bug-report inbox live.  
   [출처](https://www.youtube.com/watch?v=VpljJqzPvg0) — "Prometeo básicamente recibe cuando reportan un bug y no solo lo recibe, lo arregla."
95. **Chief bot farms a design task out to a cloud coding session** · `Grok Bot` · `youtube`  
   One bot hands a landing-page redesign to a specialist, which runs an independent session and returns three finished options. Done live from a phone with no laptop open.  
   [출처](https://www.youtube.com/watch?v=VpljJqzPvg0) — "Tres diseños distintos de esa sección con Cloud Agent." / "no es necesario que tenga mi computadora prendida"
96. **Backend, frontend and QA bots jointly ship a feature** · `Grok Bot` · `substack`  
   Role-based agents negotiate API contracts, wait on each other's dependencies, redistribute work as blockers change. Insider workshop recap of an internal Grok Bot engineering session.  
   [출처](https://mlearning.substack.com/p/grok-bot-inside-spacexais-agent-playbook) — "Backend and frontend agents negotiate API contracts, QA waits for dependencies, and the tech lead coordinates progress."
97. **Bot discovers and wires its own missing integration** · `Grok Bot` · `substack`  
   Asked for an app it has no connector for, the agent finds an MCP server, wires it in, builds its own sign-in button mid-chat. Live walkthrough, X connection segment.  
   [출처](https://genaiunplugged.substack.com/p/grok-bot-hands-every-agent-the-same) — "Ask Grok Bot for an MCP it does not have and it finds one, then hands you a button."
98. **Seven agents race to bootstrap their own startups** · `일반 에이전트` · `forum`  
   Each agent independently picks an idea, writes/deploys code, manages its own $100 budget. VPS-scheduled sessions, memory via PROGRESS.md, 1hr/week human help via GitHub.  
   [출처](https://www.indiehackers.com/post/i-gave-7-ai-agents-100-each-to-build-a-startup-heres-what-happened-on-day-1-e86ac35934) — "each session starts with the orchestrator telling the agent 'read PROGRESS.md first, this is your memory.'"
99. **Five long-running agents share one $69 box** · `일반 에이전트` · `forum`  
   One ships small PRs off the Jira board while another crawls 40 competitor pages daily. Independent parallel agents on a single MicroVM.  
   [출처](https://www.indiehackers.com/post/self-hosting-agents-went-mainstream-this-week-heres-what-8-weeks-of-running-5-actually-cost-us-576867e713) — "a coding agent that handles small PRs from our jira board / a SEO crawler that watches 40 competitor pages daily"

## SaaS 백오피스·감사 (8)

100. **Audit new-hire onboarding readiness across seven systems** · `Aside` · `official`  
   Checks offer, HRIS, identity provider, Workspace, device and payroll systems, builds one map. Multi-system audit spanning HRIS, identity provider, Workspace, device, payroll.  
   [출처](https://aside.com/blog/hr) — "Readiness map with source links and screenshots for blocked items"
101. **Review offboarding access across eight systems, revoke nothing** · `Aside` · `official`  
   Audits HRIS, Okta, Workspace, GitHub, Slack, devices and payroll, screenshots before humans act. Read-only access review, explicit no-revoke guardrail, screenshot evidence.  
   [출처](https://aside.com/blog/hr) — "Mark each item complete, still active, blocked, or needs review. Capture screenshots for still-active access and do not revoke anything"
102. **Verify SaaS renewal dates and seat counts across vendors** · `Aside` · `official`  
   Logs into every vendor portal, records seats and renewal dates, flags anything due soon. Cross-vendor login sweep, contract comparison, deadline-based flagging.  
   [출처](https://aside.com/blog/operations) — "seat counts, renewal dates, owner names, source links, and a short note on anything that needs a human decision"
103. **Triage a failed CI run and draft the PR comment** · `Aside` · `official`  
   Opens failing run, isolates the failing step, diffs against last green run, drafts comment. CI log comparison, diff-against-last-pass, ready-to-post PR comment draft.  
   [출처](https://aside.com/blog/developers) — "Open the failed CI run for this PR, identify the failing job, compare it with the last passing run, and draft a comment with links to the relevant logs."
104. **Assemble a full risk packet for one pull request** · `Aside` · `official`  
   Opens issue tracker, PR, CI checks, preview deploy, error tracker, flag dashboard in sequence. Six-tool evidence sweep: issue tracker, GitHub, CI, Sentry, feature flags, staging.  
   [출처](https://aside.com/blog/developers) — "Open the Linear issue, GitHub PR, latest checks, preview deployment, Sentry issue, feature-flag dashboard, and staging page."
105. **Confirm a feature-flag rollout matches the written plan** · `Aside` · `official`  
   Searches internal docs, opens flag dashboard, compares live value to plan, stops before editing. Doc search plus dashboard comparison, read-only verification, no changes made.  
   [출처](https://aside.com/blog/developers) — "Find our internal docs for feature flags, then open the flag dashboard and check whether the new checkout flag matches the rollout plan."
106. **Capture desktop and mobile QA screenshots of a staging flow** · `Aside` · `official`  
   Runs the signup flow on staging at two viewport widths, writes a checklist itself. Multi-viewport screenshot capture plus self-written QA checklist.  
   [출처](https://aside.com/blog/developers) — "Capture screenshots from staging for the onboarding flow at desktop and mobile widths. Save the images and write a short QA checklist."
107. **Review a DNS setup against the internal runbook, no changes** · `Aside` · `official`  
   Opens Cloudflare, host provider and internal doc, diffs live records, stages the exact fix. Three-console comparison, screenshot evidence, explicit do-not-save guardrail.  
   [출처](https://aside.com/blog/developers) — "Review our Cloudflare DNS setup for the new docs domain. ... Compare the expected records with the live records, capture screenshots, and stage the exact changes needed. Do not save changes."

## 일정·루틴 자동화 (11)

108. **Compile a Monday operations packet from five dashboards** · `Aside` · `official`  
   Opens dashboards, compares to prior week, downloads invoices, flags exceptions on a fixed day. Weekly Monday routine over live dashboards plus bulk CSV downloads.  
   [출처](https://aside.com/blog/operations) — "MRR +3.1%, support backlog +14 tickets, self-serve churn unchanged"
109. **Groom the sales pipeline automatically every Monday morning** · `Aside` · `official`  
   Wakes on a fixed schedule, checks stale deals' activity, drafts next steps unattended. Cron-style weekly routine, staleness check, flags deals lacking a reason to stay open.  
   [출처](https://aside.com/blog/sales) — "Every Monday at 8:30, Aside can open stale stage-two opportunities, check last activity, draft next steps, and flag deals with no clear reason to stay open."
110. **Send a daily engagement/social briefing at a fixed time** · `Aside` · `official`  
   Runs unattended each morning on a cron schedule, reports overnight metrics and trends. Daily 9am cron routine reporting followers, comments, likes, trending topics.  
   [출처](https://aside.com) — "You got 112 followers, 85 comments and 212 likes. Yesterday's trending topics..."
111. **Delegated research task auto-logged to ClickUp** · `Grok Bot` · `youtube`  
   Bot kicks off a research job to a specialist and writes status/owner/notes into a project tracker unasked. Creator asks Klaus to research voice-AI vendors while a ClickUp skill is active.  
   [출처](https://www.youtube.com/watch?v=TMPUUyQC5aM) — "research the top five best voice AI agent providers" / "I logged this right here in your ClickUp"
112. **Slack message triggers an agent to draft a client quote** · `Grok Bot` · `youtube`  
   New bot fires on a Slack channel post and drafts a branded price quote for a named client with no further input. Presented as a live Make/n8n replacement.  
   [출처](https://www.youtube.com/watch?v=VpljJqzPvg0) — "genera una cotización para PP para el plan plus"
113. **Bot audits and fixes its own memory files overnight** · `Grok Bot` · `youtube`  
   Chief-of-staff bot reviews its logs nightly and silently corrects its own notes with no prompting. Ran unattended while creator was on vacation.  
   [출처](https://www.youtube.com/watch?v=0fyVaDintWQ) — "it was just running in the background and doing like small improvements"
114. **Weekly skill builds an analytics dashboard unattended** · `Grok Bot` · `substack`  
   A saved skill fires every Monday morning and assembles a full Google Analytics dashboard with no manual step. Same live walkthrough.  
   [출처](https://genaiunplugged.substack.com/p/grok-bot-hands-every-agent-the-same) — "The Monday 9am skill that builds a Google Analytics dashboard on its own"
115. **Plain-language goal becomes a running pipeline** · `일반 에이전트` · `forum`  
   User states a task; agent decomposes into stages and executes end to end unattended. Research→qualify→draft outreach→follow-up chain across parallel agents.  
   [출처](https://www.indiehackers.com/post/i-m-building-a-24-7-ai-agent-that-runs-workflows-for-founders-looking-for-feedback-e5be1f9d25) — "first breaks that into stages (research → qualify → draft outreach → follow-up) and then builds the workflow"
116. **Three marketing agents run without being asked** · `일반 에이전트` · `forum`  
   Social posts, SEO, and directory scans fire on their own schedule and land in Slack. Buffer social (8:30am), weekly SEO agent, daily growth-discovery scan.  
   [출처](https://www.indiehackers.com/post/day-23-shipped-multi-ai-support-autonomous-agents-and-40-articles-zero-revenue-heres-the-data-7ba9ed9d79) — "None of this requires me to do anything — I check Slack and see what went out."
117. **그록봇 Routines: 매일 아침 브리핑 자동 실행** · `Grok Bot` · `geeknews`  
   워크플로 한 번 시연하면 예약 실행 루틴으로 저장, PR·웹훅 이벤트로도 트리거. 정기 일정+업무 이벤트 두 축 트리거 설계.  
   [출처](https://news.hada.io/topic?id=33343) — "산업 동향 관찰이나 매일 아침 브리핑 준비처럼 업무를 한 번 정의하면 필요한 시점에 Bot이 활성화됨"
118. **테크버킷: Aside 주간요약 루틴 직접 설계·검증** · `Aside` · `blog`  
   매주 요약 작업을 Routine으로 등록해 자동 재실행되도록 10단계 검증. macOS 26.2·Aside 1.0.813 실제 환경 실습.  
   [출처](https://techbukket.com/blog/aside-use-cases) — "8. 반복 업무 - 매주 요약 Routine 설계"

## 고객지원 (2)

119. **Three chained agents run a call center end to end** · `일반 에이전트` · `forum`  
   One books calls, one follows up on missed calls, one logs every transcript to CRM. Chained via Make/n8n for a home-service business.  
   [출처](https://www.indiehackers.com/post/i-analyzed-7-autonomous-ai-agents-for-business-in-2026-here-s-what-i-concluded-e34c50741f) — "one that just answers and books. another that just follows up on missed calls. another that just logs transcripts to the crm."
120. **Agent reads the order and drafts its own refund** · `일반 에이전트` · `forum`  
   On inbound support email, agent looks up order, checks policy, drafts resolution. Every refund waits on a 3-second merchant approve/decline.  
   [출처](https://www.indiehackers.com/post/i-replaced-an-entire-customer-service-department-with-ai-heres-what-happened-in-the-first-two-weeks-eA7bTzhGgoHS9vggAzlc) — "Fortuna analyses the request, checks your policy, verifies eligibility, and drafts the refund."

## 템플릿·마켓플레이스 (1)

121. **Official marketplace: dozens of installable Bot blueprints** · `Grok Bot` · `marketplace`  
   One-click install of another maker's full Bot setup as your own new Bot. 69 public Bots from 43 makers (2026-09-05), 8 categories.  
   [출처](https://x.ai/bot/marketplace) — "Alfred": "Designs, audits, and governs your Grok Bot organization so it matches real company outcomes, with clear human owners and no duplicate jobs."

## 개인 비서·일상 위임 (17)

122. **Recover last month's research sources from browsing history** · `Aside` · `official`  
   Searches its own browsing memory, reopens pages, judges relevance, exports findings unattended. Browsing-history memory search, screenshot capture, self-explained relevance reasoning.  
   [출처](https://aside.com/blog/researchers) — "Search my browsing history for pages I used in the procurement automation research last month. Reopen the likely sources, capture screenshots, explain why each page is likely relevant."
123. **Retrieve paystubs from an HR system unattended** · `Aside` · `docs`  
   Signs into HRIS, locates monthly paystubs, saves PDFs locally, asks only if MFA blocks it. Credential autofill via password manager, file save, conditional human check-in.  
   [출처](https://docs.aside.com/help/tasks.md) — "Sign in to Rippling, get my paystubs for this month, and save the PDFs to Downloads. Ask if Rippling needs MFA or a verification code."
124. **Voice command books a reservation from a parking lot** · `Grok Bot` · `youtube`  
   One spoken instruction makes the agent check calendars, pick a time, complete the booking on a website unsupervised. Real user's account on an AI news podcast.  
   [출처](https://www.youtube.com/watch?v=kckD1hgkYvk) — "navigate the reservations on a website. While I was walking in the parking lot ... I was talking to it in mixed Chinese and English."
125. **One user builds twelve working bots in a single day** · `Grok Bot` · `substack`  
   Bots independently run distinct long jobs at once: landing-page lead, customer-language researcher, travel planner, sauna researcher. First-hand newsletter account with demo video.  
   [출처](https://natesnewsletter.substack.com/p/grok-bot-review) — "In roughly eight hours, I built twelve working Bots. One became my Chief of Staff, another led a landing-page project, and a research specialist looked for customer language."
126. **Trello bot reviews and reprioritizes the day's tasks** · `Grok Bot` · `medium`  
   Given scoped Trello access, the bot inspects the day's plan and proposes reprioritization on its own. First-hand product-review walkthrough.  
   [출처](https://maa1.medium.com/grok-bot-product-review-22637fd0ed04) — "I ask my Trello Planner bot to check my daily plans and suggest things to reprioritise or move to another day."
127. **Chief Agent files a daily status report unasked** · `일반 에이전트` · `forum`  
   9am agent drafts a PDF of priorities, revenue, blockers, drift with zero prompting. 1 of 13 scheduled Claude-based agents, $100/mo, all logging to Notion.  
   [출처](https://www.indiehackers.com/post/i-replaced-my-morning-routine-with-13-ai-agents-heres-what-they-do-b18ca8b97b) — "Chief agent sends a PDF with priorities, revenue status, blockers, and what's drifting."
128. **One agent told to run a whole business alone** · `일반 에이전트` · `forum`  
   Given an open goal, agent picked product, wrote content, tried channels for 10 weeks. Ran unattended across X, dev.to, GitHub, Gumroad; self-reported after 10 weeks.  
   [출처](https://www.indiehackers.com/post/i-am-an-autonomous-ai-agent-10-weeks-2-sales-54-here-is-what-i-actually-learned-300698bdfe) — "My job is to build and sell developer productivity tools without supervision."
129. **Aside launch: browser-native agent** · `Aside` · `x-founder`  
   Founder announces browser agent that signs into sites end-to-end without integrations. Product launch post from Aside's founder.  
   [출처](https://x.com/hyojun_at/status/2069497198879048131) — "Today, we're launching Aside, the AI browser you've waited for... SOTA on agentic browsing benchmarks: outperforms Claude Fable"
130. **Aside adopted as AI-agent credential browser** · `Aside` · `x-user`  
   AI agents given persistent logged-in web/credential access via a dedicated remote browser. GStack set Aside as default remote-session browser for its AI agents.  
   [출처](https://x.com/garrytan/status/2095948689823121872) — "Does your AI agent need access to web and credentials as you? Aside is now the #1 absolute best way to do it"
131. **Grok Bot framed as 24/7 employee running departments** · `Grok Bot` · `x-user`  
   Users hand entire functional departments to persistent bots under one subscription. Overview post preceding a department-bots thread.  
   [출처](https://x.com/PrajwalTomar_/status/2088996708999172395) — "the closest thing to a 24/7 employee... People are handing it whole departments"
132. **One operator runs inbox, research, calendar, groceries, calls via bots** · `Grok Bot` · `x-user`  
   One person delegates 6+ life/work domains to always-on agents wired to outside tools. Bots wired to ESPN, Instacart, arXiv/Digg, Twilio/X.  
   [출처](https://x.com/mvanhorn/status/2092629365045559547) — "it already runs his inbox, his research, his meeting notes, his kids' calendar, his grocery cart, and... phone calls for him in Portuguese"
133. **디시 그록갤: 헤비유저용 그록봇+커서 정보 총합** · `Grok Bot` · `dc`  
   그록 헤비플랜 유저가 그록봇·커서 무료 사용법을 정리해 공유. 그록 프롬프트 마이너 갤러리 정보 총합 게시글(본문 일부만 확인).  
   [출처](https://gall.dcinside.com/mgallery/board/view/?id=grok_prompt&no=19973) — "워낙에 우리갤에 헤비플랜 사용자가 많으니 놓치면 아까울꺼 같아서 올림"
134. **브런치: Aside 비밀번호금고·메모리로 인턴처럼 위임** · `Aside` · `blog`  
   로그인 세션 그대로 쓰는 브라우저에 업무 위임, 마크다운 메모리로 맥락 유지. 며칠 사용 후 설치·CLI연동·사용법 정리.  
   [출처](https://brunch.co.kr/@sukistory/133) — "Aside를 며칠 써보니 브라우저가 아니라 제 계정에 이미 로그인해 있는 인턴 한 명을 둔 기분입니다"
135. **그록봇으로 조언자·리서치·항공권감시 봇 5개 운용** · `Grok Bot` · `blog`  
   조언자·유튜브리서치·X타임라인·이메일정리·항공권감시 다섯 봇 동시 운용. 피터 양 실사용 사례를 한국 뉴스레터가 소개.  
   [출처](https://news.aikoreacommunity.com/grok-bot-5-real-use-cases/) — "조언자를 만들고, 유튜브를 리서치하고, X 타임라인을 훑고, 이메일을 정리하고, 항공권까지 감시하는 다섯 개의 봇"
136. **gpters: 두 달째 쓴 Aside 노코드 커뮤니티 소개** · `Aside` · `community`  
   개인적으로 신세계라 느낀 Aside를 두 달째 사용 중이라며 소개. gpters 노코드 게시판 실사용 소개.  
   [출처](https://www.gpters.org/nocode/post/aside-browser-browser-agent-1Zw10O4oLgXb8x7) — "개인적으로 너무 신세계라 생각되어 소개드려봅니다"
137. **gpters: 그록봇 컴퓨터 계정당 1대 공유 정정** · `Grok Bot` · `community`  
   봇마다 컴퓨터가 따로 있다는 오해를 정정, 계정당 1대를 여러 봇이 공유. 공식문서·보도 대조한 국내 가이드 글.  
   [출처](https://www.gpters.org/news/post/grok-bot-guide-price-setup-5JRJexbz1E9YgB2) — "봇마다 컴퓨터가 따로 생기는 게 아니라, 계정당 한 대를 모든 봇이 공유합니다"
138. **메일리: 클로드코드+Aside 결합 실사용 후기** · `Aside` · `blog`  
   스레드 추천으로 Aside 접해 테스트, 로그인된 브라우저 안 에이전트 작동구조 정리. 유튜브 리뷰 붐 직후 개인 뉴스레터 후기.  
   [출처](https://maily.so/isaac.perform/posts/vpzlnxpdrk9) — "로그인된 내 브라우저에서 일하는 AI"

## 카테고리별 시사점 (우리 Belmont 관점)

- **봇이 봇을 생성 / 비서실장 / 그룹채팅 인계**는 우리 Belmont 에 이미 있는 도구(CreateAgent, SendToAgent, 그룹, 관리자 페르소나, 15분 Job sweeper)와 1:1로 대응한다. 빠진 건 봇이 스스로 `CreateGroup`·`CreateRoutine` 하는 도구 두 개뿐.
- **일정·루틴 자동화**가 거의 모든 사례의 공통 뼈대다(매일 아침 브리핑, 주간 리뷰, 밤사이 아웃리치 초안). Belmont 루틴이 이미 도는 자리.
- **가장 반복되는 안전장치**: 발송·결제·비가역 동작은 항상 사람 승인. Aside 공식 예시도, 마켓플레이스 봇도, Indie Hackers 운영자도 모두 이 선을 지킨다. 우리 Guard 승인과 같은 설계.
- **트레이딩·밈코인 사례($1K→$80K 류)는 자가 보고 수치**이니 기능 근거로 쓰지 말 것. 구조(멀티에이전트 데스크)는 실재하나 성과는 미검증.

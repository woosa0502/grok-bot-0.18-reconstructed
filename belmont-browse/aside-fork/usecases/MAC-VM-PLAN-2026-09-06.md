# 맥OS 가상머신 실행서 — 원본 Aside 1.0.825.1 나란히 보기 (2026-09-06)

> **약관**: 애플 사용권 계약은 맥OS를 애플 하드웨어에서만 돌리도록 한다. 이 문서는 애플 하드웨어가
> 아닌 곳에서 돌리는 절차다. 사용자가 알고 선택했다. 결과물을 밖으로 내보내지 마라.

준비는 끝났다. KVM만 없다. 아래 §1을 사용자가 하면 그 다음부터 이어서 돌린다.

준비물 요약은 `/home/hoon/mac-vm/README.md`. 이 문서는 순서만 적는다.

---

## 0. 먼저 읽을 것 — 준비 중에 바뀐 것 세 가지

**(1) CPU가 인텔이 아니라 AMD다.** 이 컴퓨터는 AMD 라이젠 7 9800X3D다(`svm` 플래그).
맥OS 커널은 CPU 제조사 문자열을 보고 인텔 전용 명령·레지스터를 쓴다. 그래서 가상 CPU를
`vendor=GenuineIntel`로 위장한다. OSX-KVM 저장소가 "요즘 라이젠은 소노마까지 잘 된다"고
적어 놨고, 라이젠 9 5900HS에서 됐다는 기록도 있다. 커널 패치는 필요 없다.
자세한 이유는 `boot.sh` 위쪽 주석에 6줄로 적어 뒀다.

**(2) 포트를 바꿨다.** 지시받은 VNC 5901은 **벨몬트 포크의 x11vnc가 이미 쓰고 있다.**
5900·5901·5902는 x11vnc, 6081·6082는 봇 noVNC 몫이다. 그래서 맥 가상머신은:

| 쓰임 | 포트 | 원래 지시 |
|---|---|---|
| 가상머신 VNC | **5905** | 5901 (충돌) |
| noVNC (브라우저로 보기) | **6090** | 6090 (그대로) |
| 맥으로 SSH | **2299** | 2222 (이미 쓰는 중) |

**(3) 공유 폴더는 9p가 아니라 SMB다.** 맥OS에는 9p(virtfs) 드라이버가 없다. 대신 QEMU가
자기 SMB 서버를 띄우게 했다. 맥 안에서 `smb://10.0.2.4/qemu` 로 붙으면
`/home/hoon/mac-vm/share` 가 그대로 보인다.

---

## 1. 사용자가 할 것 (한 번만)

윈도우 PowerShell에서:

```powershell
wsl --shutdown
```

그리고 WSL 터미널을 다시 연다. `.wslconfig`에는 이미 `nestedVirtualization=true`가 들어 있다.
다시 연 뒤 WSL에서 확인:

```bash
ls -l /dev/kvm && echo "됐다"
```

`/dev/kvm`이 안 보이면 §6을 봐라.

---

## 2. 메모리 비우기 (가상머신 띄우기 직전)

WSL 전체가 16GB다. 가상머신이 8GB를 가져간다. 그래서 벨몬트 호스트·서비스·포크 크롬을 먼저 끈다.

**규칙**: 자기 셸을 죽이는 `pkill -f` 통짜 패턴은 쓰지 마라 (HANDOFF §3·§7-5).

```bash
cd /home/hoon/_roots/labs/work/Belmont/belmont-browse
kill $(python3 -c "import json;d=json.load(open('.state/serve.json'));print(d['pid'],d.get('chromePid',''))")
sleep 2
pkill -f '[c]hrome-profile --window-size'
free -g          # available 가 12 이상이면 좋다
```

봇 tmux(`belmont-bot`)도 돌고 있으면 같이 내린다.

**메모리 규칙**: 가상머신이 떠 있는 동안 벨몬트 호스트를 같이 올리지 마라. 둘 다 올리면
WSL이 스왑으로 밀려서 양쪽 다 느려지고, 맥OS 설치가 중간에 멈출 수 있다.
두 개를 나란히 봐야 하면 `boot.sh`의 `ALLOCATED_RAM`을 6144로 낮추고 `CPU_CORES`를 2로 줄여라.

---

## 3. 맥OS 설치 (한 번, 30~60분 + 재부팅 2~3회)

```bash
/home/hoon/mac-vm/boot.sh
```

떠 있는 채로 두고, **다른 터미널**에서 화면을 연다:

```bash
/home/hoon/mac-vm/novnc.sh --bg
```

윈도우 브라우저에서:

```
http://127.0.0.1:6090/vnc.html?host=127.0.0.1&port=6090&autoconnect=true&resize=scale
```

화면에서 할 일, 순서대로:

1. OpenCore 부팅 화면에서 **macOS Base System**을 고른다 (화살표 + Enter).
2. 언어를 고른다.
3. **디스크 유틸리티**를 연다. 왼쪽에서 `QEMU HARDDISK Media` **120GB짜리**를 고른다.
   (BaseSystem 3.2GB짜리를 지우면 안 된다.) `지우기` → 이름 `Macintosh HD`,
   형식 **APFS**, 방식 **GUID 파티션 맵**.
4. 디스크 유틸리티를 닫고 **macOS 설치**를 고른다. `Macintosh HD`를 고른다.
5. 30~60분. 중간에 저절로 2~3번 재부팅한다. **재부팅할 때마다 OpenCore 화면에서
   `macOS Installer` 또는 나중엔 `Macintosh HD`를 골라야 한다.** 안 고르면 그 자리에 서 있는다.
6. `Country Selection` 같은 화면에서 몇 분씩 멈춘 것처럼 보여도 기다려라 (OSX-KVM README 경고).
7. 계정을 만든다. 계정 이름은 `hoon`, 비밀번호는 사용자가 정한다.
   (자동 조작에 쓸 거라 어려운 비밀번호는 피하는 게 낫다.)

설치가 끝나면 가상머신을 끄고, 설치 미디어를 뗀 채로 다시 띄운다:

```bash
/home/hoon/mac-vm/stop.sh
/home/hoon/mac-vm/boot.sh --no-install
```

---

## 4. 맥OS 첫 설정 (자동 조작 준비)

VNC로 보면서 손으로 한다. 5분.

1. **원격 로그인 켜기** — 시스템 설정 → 일반 → 공유 → 원격 로그인 켬.
   그러면 WSL에서 `ssh -p 2299 hoon@127.0.0.1` 로 붙는다. 한글 지시문을 넣는 유일한 방법이다(§5).
2. **화면 잠금·절전 끄기** — 시스템 설정 → 잠금 화면 → 전부 `안 함`.
   자동 조작 중에 화면이 잠기면 캡처가 다 검게 나온다.
3. **공유 폴더 붙이기** — Finder → 이동 → 서버에 연결 → `smb://10.0.2.4/qemu` → 게스트.
   `/home/hoon/mac-vm/share`가 열린다. 여기 `Aside-1.0.825.1.dmg`가 이미 들어 있다.
4. **Aside 설치** — 그 dmg를 두 번 눌러 열고 `Aside.app`을 `응용 프로그램`으로 끈다.
   처음 열 때 "확인되지 않은 개발자" 경고가 나오면 시스템 설정 → 개인정보 보호 및 보안에서 `그래도 열기`.
5. **Aside 첫 실행** — 계정 로그인은 **사용자가 직접 한다.** 자동 조작에 계정 정보를 넣지 마라.

---

## 5. 검사표 조작을 원본에서 반복하기

목표: `usecases/PARITY-CHECKLIST.md`의 ★1~★16과 `campaign/LIVE-RESULT.md`의 L1~L10을
**같은 문장으로** 원본 Aside에서 시키고 화면을 찍는다. 우리 캡처는
`belmont-browse/aside-fork/ui-shots/` 에 130장 있다. 그것과 짝을 맞춘다.

### 화면 찍는 방법 두 가지

```bash
# (가) QEMU 모니터. VNC 연결이 없어도, 화면이 잠겨 있어도 찍힌다.
/home/hoon/mac-vm/shot.sh MAC-L1-agent-tabs-badge

# (나) VNC 쪽. 조작 대본 안에서 찍을 때.
python3 /home/hoon/mac-vm/drive.py 대본.txt
```

둘 다 `/home/hoon/mac-vm/share/shots/` 로 간다. 맥 안에서도 같은 폴더가 보인다.

### 조작 대본

`drive.py` 명령: `move X Y`, `click`, `doubleclick X Y`, `drag X Y`, `key cmd-t`,
`type 영문글자`, `shot 이름`, `wait 2.5`. 예:

```
# MAC-L1 — 에이전트 탭 개수 배지
key cmd-l
type news.ycombinator.com
key enter
wait 3
shot MAC-L1-agent-tabs-badge
```

### ⚠ 한글 지시문은 `type`으로 못 넣는다

VNC는 키를 눌렀다는 신호만 보낸다. 한글은 맥OS 입력기가 조합해서 만드는 글자라 그 신호로는
안 나온다. VNC 클립보드도 게스트 쪽에 받아 주는 프로그램이 있어야 하는데 맥OS에는 없다.

**검사표 지시문은 전부 한글이다.** 그러니 이렇게 넣는다 (§4-1에서 원격 로그인을 켠 뒤):

```bash
# 1. 지시문을 맥 클립보드에 올린다
echo 'Hacker News에 가서 첫 화면 상위 3개 기사를 한국어로 요약해 줘. 기사마다 소제목, 요점 두 가지, 출처 링크를 붙여 줘.' \
  | ssh -p 2299 hoon@127.0.0.1 pbcopy

# 2. Aside 입력칸을 누르고 붙여넣는다
printf 'move 900 700\nclick 1\nwait 0.5\nkey cmd-v\nkey enter\nwait 30\nshot MAC-star1-hn-summary\n' > /tmp/s.txt
python3 /home/hoon/mac-vm/drive.py /tmp/s.txt
```

좌표(900 700)는 화면을 한 번 찍어 보고 맞춰라. 화면은 1280x800이다.

시간을 재야 하는 항목(★1은 18초, ★2는 39초)은 지시를 보낸 시각과 결과가 뜬 시각을
`date +%s`로 찍어 두고 검사표 "우리 결과" 칸에 넣는다.

### 우선 순위

계정 없이 되는 ★1~★6, ★11, ★12, ★15부터 한다. 계정이 필요한 B1~B8과 네이버가 걸린
★7·★8은 사용자가 로그인한 뒤에만 된다.

---

## 6. 우리 포크를 맥용으로 빌드하기

### 먼저 — 원본 쪽은 이미 뽑아 놨다 (가상머신 필요 없음)

원본 dmg를 리눅스에서 열어 **원본 실행 파일을 이미 꺼내 뒀다.**

```
data/artifacts/aside_fork_map_825_20260906/raw/Aside-Framework-1.0.825.1.universal   (503MB, 유니버설)
data/artifacts/aside_fork_map_825_20260906/raw/Aside-Framework-1.0.825.1.x86_64      (263MB, x86_64만)
```

`compare_unwind_blocks.py`는 x86_64 Mach-O를 받으므로 뒤엣것을 쓴다. `llvm-objdump`도
깔아 뒀다(`/usr/bin/llvm-objdump`, LLVM 18.1.3). 즉 **비교의 "원본" 쪽은 준비 끝이다.**
남은 건 우리 포크의 맥 빌드뿐이다.

(어떻게 꺼냈는지: 이 dmg는 압축 방식 `0x80000008`(XZ)을 써서 `dmg2img`와 `7z`가 둘 다
반쪽만 푼다. 그래서 `/home/hoon/mac-vm/dmg_extract.py`를 만들어 풀고, `fsapfsmount`로
APFS를 붙여 파일을 꺼냈다. 다시 하려면 §7 참고.)

### 빌드 절차 (가상머신 안에서)

```bash
# 맥OS 안에서
xcode-select --install                      # 명령줄 도구
# 크로미움은 전체 Xcode 가 필요하다. App Store 에서 Xcode 16 을 받는다 (약 40GB).
sudo xcodebuild -license accept

git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git ~/depot_tools
export PATH="$HOME/depot_tools:$PATH"

mkdir ~/chromium && cd ~/chromium
fetch --no-history chromium                 # --no-history 로 20GB 아낀다
cd src
# 우리 포크의 변경을 여기에 얹는다 (source/host/... 패치)
gn gen out/mac --args='target_cpu="x64" is_debug=false is_official_build=false symbol_level=1'
autoninja -C out/mac chrome
```

### 솔직하게 — 이 가상머신에서 이 빌드는 빠듯하다

| 항목 | 필요 | 가상머신에 있는 것 | 판정 |
|---|---|---|---|
| 디스크 | Xcode 40GB + 소스 30GB + 결과물 40GB ≈ 110GB | 120GB (맥OS가 20GB 먹음) | **모자란다** |
| 메모리 | 링크할 때 8GB 이상 | 8GB | 빠듯 |
| 코어 | 많을수록 | 4 | 느림 |
| 시간 | 8코어에서 3~5시간 | 4코어·가상 디스크 | **12~20시간** |

**디스크는 실제로 모자란다.** 빌드 전에 늘려라. qcow2라 실제로 쓴 만큼만 차지한다:

```bash
/home/hoon/mac-vm/stop.sh
qemu-img resize /home/hoon/mac-vm/OSX-KVM/mac_hdd_ng.img +150G
# 다시 띄운 뒤 맥OS 디스크 유틸리티에서 Macintosh HD 를 늘린다
```

**지문 비교의 정밀도 한 줄.** `compare_unwind_blocks.py`는 세 가지로 본다:
`raw`(바이트 그대로), `operand`(숫자만 지운 디스어셈블), `mnemonic`(명령어 이름 순서만).
원본 Aside는 `is_official_build=true`(LTO+PGO)로 빌드된 것이고, 이 가상머신에서 LTO 링크는
8GB로 거의 확실히 실패한다. 그러니 우리 빌드는 LTO 없이 하고 **`mnemonic` 층에서만 비교해라.**
`raw`와 `operand`는 최적화 차이 때문에 어차피 크게 벌어진다. 그걸 "다르다"의 근거로 쓰면
틀린 결론이 나온다.

---

## 7. 원본 dmg를 다시 풀어야 할 때

```bash
python3 /home/hoon/mac-vm/dmg_extract.py /home/hoon/mac-vm/share/Aside-1.0.825.1.dmg /tmp/aside-full.img
mkdir -p /tmp/asidemnt
fsapfsmount -o 20480 /tmp/aside-full.img /tmp/asidemnt
ls /tmp/asidemnt/Aside.app/Contents/
# 끝나면
fusermount -u /tmp/asidemnt
```

---

## 8. 안 될 때

| 증상 | 볼 것 |
|---|---|
| `/dev/kvm`이 없다 | `.wslconfig`에 `nestedVirtualization=true`가 있나. `wsl --shutdown` 했나. 윈도우에서 Hyper-V/가상 머신 플랫폼 기능이 켜져 있나. |
| `/dev/kvm`은 있는데 권한 오류 | `sudo chmod 666 /dev/kvm`. hoon은 이미 kvm 그룹에 넣어 뒀다. |
| OpenCore 화면에서 재부팅만 반복 | `cat /sys/module/kvm/parameters/ignore_msrs`가 `Y`인가. `boot.sh`가 켜지만 확인해라. |
| 부팅 중 커널 패닉 | `boot.sh`의 `CPU_MODEL`을 `Penryn`으로 바꿔 본다 (단 벤투라 이상은 AVX2가 필요해 안 될 수 있다). 그다음 후보는 `Skylake-Client,-hle,-rtm`. |
| 화면이 작은 구석에만 그려진다 | OSX-KVM `notes.md`의 "Resolution in Ventura" 절. `vmware-svga`를 이미 쓰고 있어서 안 나올 것이다. |
| 설치 중 멈춘 것 같다 | 기다려라. `Country Selection`에서 몇 분 서 있는 건 정상이다. `shot.sh`로 찍어 화면이 진짜 안 바뀌는지 봐라. |
| WSL 전체가 느려진다 | 벨몬트 호스트를 껐나(§2). `free -g`로 스왑을 보라. |

### 되돌리기

`.wslconfig`를 원래대로:

```bash
cp /home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/campaign/wslconfig.backup-2026-09-06 \
   /mnt/c/Users/HOON/.wslconfig
# 그리고 PowerShell 에서 wsl --shutdown
```

백업본에는 `nestedVirtualization=true`만 빠져 있고 나머지는 같다.

가상머신을 통째로 지우려면 `/home/hoon/mac-vm/`을 지운다. 벨몬트 쪽 파일은 하나도 안 건드렸다.

---

## 9. 재시작 뒤 첫 명령

```bash
ls -l /dev/kvm && cat /sys/module/kvm/parameters/ignore_msrs
```

`/dev/kvm`이 보이면 §2 → §3으로 간다.

# Cloudflare 무료 운영

화면·Express API·계산 규칙을 유지하고, DB 연결만 Cloudflare의 **SQLite 기반 Durable Object**로 바꿉니다. 태블릿과 PC는 같은 배포 주소를 사용합니다. 코드와 배포 설정은 기존 GitHub 저장소에 보관하며 DB·비밀번호·배포 토큰은 올리지 않습니다.

## 요금·제약

- Workers Free / SQLite Durable Objects Free에서 운영합니다. 유료 플랜·도메인 구매·R2는 필요하지 않습니다. 무료 `workers.dev` HTTPS 주소를 사용합니다.
- 2026-11-08 공식 기준: DO 요청 하루 10만 건, 실행 시간 13,000 GB-s/일, SQL 행 읽기 500만·쓰기 10만/일, 저장소 계정 총 5GB(무료 DB당 1GB). 행 한도는 출퇴근 건수와 다르며 조회·세션·연결 상태 확인도 사용량입니다.
- 무료 한도 초과 시 요청이 실패할 수 있습니다. 무료 플랜을 유지하며 대시보드 사용량을 확인합니다. 실제 사용량·제공 정책에 따라 영구 무료를 보장하지는 않습니다.
- 데이터는 프로세스 메모리·임시 파일이 아닌 영구 SQLite에 저장합니다. 고정한 `feeledu-primary` 객체 이름·`ACADEMY` 바인딩·Worker 이름을 임의로 바꾸거나 삭제하지 않습니다.
- Cloudflare PITR는 최근 30일 복구를 지원합니다. 별도의 전체 백업도 내려받아 다른 장소에 보관합니다. 자동 복구 기능을 실제 공개 환경에서 검증하기 전에는 복구 가능하다고 단정하지 않습니다.

공식 근거: [요금](https://developers.cloudflare.com/durable-objects/platform/pricing/), [SQLite·PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [정적 파일](https://developers.cloudflare.com/workers/static-assets/).

## 검증

```sh
npm ci --ignore-scripts
npm run check
npm run cloud:check
npm run test:cloud:e2e
```

실제 Worker 런타임의 로컬 에뮬레이터에서 전체 브라우저 흐름을 검사합니다. 테스트는 임시 DB를 쓰며 `data/feeledu.db`를 수정하지 않습니다.

## 배포

1. Cloudflare 무료 계정에 공식 Wrangler OAuth로 로그인합니다. 로그인·권한 동의는 사용자가 완료합니다. 현재 CLI는 지정한 범위에 `offline_access`를 자동 추가하므로 이 권한도 사용자 승인이 필요합니다. 비밀번호·인증코드는 채팅으로 보내지 않습니다.
2. `npm run cloud:deploy`로 배포합니다. 최초에는 운영 비밀값이 없어 API가 503으로 응답하며 임의의 초기 계정 등록을 허용하지 않습니다.
3. 강한 임의 문자열 `SETUP_TOKEN`과 일회용 `MIGRATION_TOKEN`을 **Wrangler secret bulk의 표준 입력**으로 설정합니다. 값은 소스·명령 인수·출력·추적 로그에 남기지 않습니다.
4. 새 배포가 비어 있는 상태에서 로컬 DB를 이전합니다. 이전 전에 SQLite 백업을 만들고 로컬에서 입력을 잠시 멈춥니다. `MIGRATION_TOKEN`은 실행 프로세스의 환경변수로만 전달합니다.

```sh
node scripts/cloud-migrate.mjs https://actual-name.actual-account.workers.dev data/feeledu.db
```

5. 이전 후 건수·관리자 로그인·시급·정산을 확인합니다. 정상 이전은 한 번만 허용하며 기존 운영 DB를 덮어쓰지 않습니다. 손상·누락·외래키 오류는 전체 롤백합니다. 세션·임시 연결 코드는 이전하지 않으므로 관리자 재로그인과 새 주소의 태블릿 연결이 필요합니다.
6. `MIGRATION_TOKEN`을 운영 비밀값에서 제거합니다. 운영 계정이 들어간 뒤에는 코드에서도 재이전을 차단합니다.
7. 태블릿 대기 기록을 먼저 전송하거나 복구 파일로 보관한 뒤 새 HTTPS 주소의 `/kiosk`를 연결·설치합니다. PC는 같은 주소의 `/admin`을 엽니다. 공개 주소에서 저장·새로고침·재로그인·오프라인 복귀를 확인한 뒤 로컬 운영을 종료합니다.

현재 공개 주소·계정 정보는 배포 성공 후 기록합니다. 로컬 3000 포트의 미리보기나 일시적인 미리보기 URL을 운영 배포로 간주하지 않습니다.

## 백업·업데이트

Cloudflare의 **전체 백업 받기**는 검사값을 포함한 `.json`입니다. 관리자 암호 해시·급여가 들어 있으므로 다른 사람에게 공유하지 않습니다. 필요하면 **새 SQLite 파일**로 복구할 수 있습니다.

```sh
node scripts/restore-snapshot.mjs backup.json recovered/feeledu.db
```

복구 도구는 기존 출력 파일을 덮어쓰지 않습니다. 기존 Node 서버의 `.db` 백업 방식도 유지합니다.

업데이트 전 백업 → 테스트 → 같은 Worker에 재배포 → 기록 확인 순서입니다. `wrangler.jsonc`의 SQL 클래스 마이그레이션 기록은 삭제·재작성하지 않고 새 마이그레이션만 추가합니다. 사이트 삭제·DO 클래스 삭제·새 이름의 Worker 생성은 일반 업데이트가 아닙니다.

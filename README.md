# Velog Series Stats

Velog에 작성한 게시글의 조회수를 **시리즈별로 집계**해서 보여주는 Chrome 확장 프로그램입니다.

## 목적

Velog는 게시글별 조회수는 확인할 수 있지만, 시리즈 단위로 묶어서 총 조회수나 평균 조회수를 보여주는 기능은 제공하지 않습니다. 이 확장 프로그램은 로그인한 사용자의 게시글 목록과 조회수 데이터를 가져와 시리즈별로 그룹화하고, 시리즈별 총조회수·평균 조회수를 팝업 화면에 보여주는 것을 목표로 합니다.

## 동작 흐름

1. `chrome.tabs`로 열려있는 velog.io 탭을 찾거나 없으면 새로 엶
2. `chrome.scripting.executeScript`로 그 탭 안에 GraphQL 요청 코드를 주입해서 실행 (Origin이 실제로 `https://velog.io`가 되도록)
3. `auth` 쿼리로 로그인한 사용자의 username 확인
4. Velog GraphQL API로 내 게시글 전체 목록, 시리즈 목록, 게시글-시리즈 매핑 조회 → 조회수 없이 시리즈 목록(게시글 수 기준)부터 즉시 렌더링
5. 게시글 조회수는 GraphQL alias로 여러 `getStats`를 한 요청에 묶어 배치 조회 (요청당 5개, 배치는 순차 처리), 배치가 도착할 때마다 화면에 점진적으로 반영
6. `series.id` 기준으로 게시글 그룹화, 시리즈별 총조회수 및 평균 조회수 계산
7. 팝업 화면에 결과 렌더링 (게시글 수 / 조회수 정렬 선택 가능, 조회수 정렬은 전체 로딩 완료 후 한 번에 재정렬)

서버 없이 확장 프로그램 내부에서 모든 과정이 완결되도록 설계합니다 (별도 백엔드 없음).

**왜 탭에 스크립트를 주입하는가:** 확장 프로그램 팝업(`chrome-extension://...` origin)에서 직접 `https://v3.velog.io/graphql`로 fetch하면 CORS는 `host_permissions`로 통과하더라도, 서버가 Origin을 보고 빈 응답(200 + 빈 body)을 준다. 실제 velog.io 페이지 안에서 실행되는 코드는 진짜 `https://velog.io` Origin을 가지므로 정상적으로 응답을 받는다.

## 확인된 Velog GraphQL API 구조

velog.io 개발자도구 Network 탭에서 직접 확인한 실제 요청 구조입니다.

| 용도               | operationName                           | 핵심 필드                                                                                                      |
| ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 게시글 목록        | `velogPosts`                          | `id, title, url_slug, tags, released_at, updated_at, comments_count, likes, is_private` (시리즈 필드는 없음) |
| 시리즈 목록        | `getUserSeriesList`                   | `id, name, url_slug, posts_count`                                                                            |
| 게시글-시리즈 연결 | 게시글 상세 조회 시`series` 필드 포함 | `series { id, name, url_slug, series_posts { id, post { id } } }`                                            |
| 조회수             | `GetStats`                            | `total, count_by_day { count, day }`                                                                         |

```graphql
query GetStats($post_id: ID!) {
  getStats(post_id: $post_id) {
    total
    count_by_day {
      count
      day
    }
  }
}
```

게시글 목록 쿼리(`velogPosts`)에는 `series` 필드가 없으므로, 시리즈 매핑은 게시글 상세 조회 응답의 `series` 필드를 활용해야 합니다.

**조회수 배치 조회:** Velog에는 여러 게시글의 조회수를 한 번에 조회하는 API가 없어서, GraphQL alias로 여러 `getStats` 호출을 한 요청에 묶어 왕복 횟수를 줄입니다 (`chrome.scripting.executeScript` 탭 주입 왕복 1회당 오버헤드가 커서, 요청 수 자체를 줄이는 게 raw 네트워크 시간 단축보다 효과가 큽니다). 단, alias는 서버에서 병렬로 처리되어 DB 커넥션을 그만큼 동시에 열 수 있음 — 배치 크기를 30으로 시도했다가 Velog 서버의 Prisma 커넥션 풀 한도(5)를 넘겨 `Timed out fetching a new connection from the connection pool` 에러를 유발한 적이 있어(2026-07-23), 요청당 alias 5개 + 배치 순차 처리로 낮춰서 사용 중.

```graphql
query GetStatsBatch($id0: ID!, $id1: ID!) {
  s0: getStats(post_id: $id0) { total }
  s1: getStats(post_id: $id1) { total }
}
```

**커넥션 풀 타임아웃 재시도:** 배치 크기를 조정해도, velog 탭을 새로 여는 시점엔 페이지 자신의 초기화 요청과 겹쳐 커넥션 풀이 일시적으로 고갈될 수 있습니다. 이런 경우까지 완전히 막을 순 없어서, `requestVelogGraphql`(`src/api/graphqlClient.ts`)이 에러 메시지에 `"connection pool"`이 포함된 경우에만 짧게 대기 후 최대 2회 재시도합니다. 자세한 배경은 `docs/devlog/260727-*.md` 참고.

## 기술 스택

- **TypeScript** — Chrome 확장 프로그램(Manifest V3) 개발 및 Velog GraphQL 응답 타입 안전성 확보
- **esbuild** — 번들링
- **Chrome Extension Manifest V3** — `service_worker` 기반 백그라운드, `scripting` / `tabs` / `storage` 권한 사용
- 프레임워크 없는 순수 DOM 조작 (초기 버전 기준, React 미사용)

## 프로젝트 구조

```
velog-series-stats/
├── public/
│   ├── manifest.json
│   ├── popup.html
│   └── popup.css
├── src/
│   ├── background.ts
│   ├── popup.ts
│   ├── api/
│   │   ├── graphqlClient.ts
│   │   ├── postApi.ts
│   │   ├── seriesApi.ts
│   │   ├── statsApi.ts
│   │   └── userApi.ts
│   ├── model/
│   │   ├── post.ts
│   │   ├── series.ts
│   │   ├── stats.ts
│   │   └── user.ts
│   └── service/
│       └── seriesAggregator.ts
├── scripts/
│   └── build.mjs
├── dist/
├── package.json
└── tsconfig.json
```

## 개발 현황

- [X] 최소 Chrome 확장 프로그램 스켈레톤 구축 및 로드 확인 ([#1](https://github.com/doHoaSen/Velog-Series-Stats/issues/1))
- [X] Velog GraphQL API 구조 조사 (게시글 목록, 시리즈 목록, 게시글-시리즈 연결, 조회수)
- [X] 데이터 파이프라인 구현 — 모델 타입, GraphQL 클라이언트/요청 함수, 집계 로직, 팝업 결과 출력 ([#3](https://github.com/doHoaSen/Velog-Series-Stats/issues/3), PR #4)
- [X] 조회수 로딩 성능 개선 + 정렬 UI + 로딩 마이크로 인터랙션 ([#5](https://github.com/doHoaSen/Velog-Series-Stats/issues/5), PR #6)
- [ ] 세션 간 캐싱 (`chrome.storage`에 이전 결과 저장 후 재실행 시 즉시 표시)
- [ ] 시리즈별 지연 로딩 UI (특정 시리즈만 선택해서 조회수 조회)

## 빌드

```bash
npm install
npm run check   # tsc --noEmit
npm run build   # esbuild 번들링 → dist/
```

`chrome://extensions` → 개발자 모드 활성화 → "압축해제된 확장 프로그램을 로드합니다" → `dist` 폴더 선택

## 저장소 트래픽

GitHub Insights의 트래픽 통계는 최근 14일치만 보여주지만, [`traffic-stats.yml`](.github/workflows/traffic-stats.yml) 워크플로가 매일 조회수·클론수를 누적 기록합니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/traffic-data/traffic-stats-dark.svg">
  <img src=".github/traffic-data/traffic-stats-light.svg" alt="저장소 누적 조회수 및 클론수">
</picture>

## 라이선스

[MIT](./LICENSE) © doHoaSen

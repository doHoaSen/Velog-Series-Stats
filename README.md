# Velog Series Stats

Velog에 작성한 게시글의 조회수를 **시리즈별로 집계**해서 보여주는 Chrome 확장 프로그램입니다.

## 목적

Velog는 게시글별 조회수는 확인할 수 있지만, 시리즈 단위로 묶어서 총 조회수나 평균 조회수를 보여주는 기능은 제공하지 않습니다. 이 확장 프로그램은 로그인한 사용자의 게시글 목록과 조회수 데이터를 가져와 시리즈별로 그룹화하고, 시리즈별 총조회수·평균 조회수를 팝업 화면에 보여주는 것을 목표로 합니다.

## 동작 흐름

1. `chrome.tabs`로 열려있는 velog.io 탭을 찾거나 없으면 새로 엶
2. `chrome.scripting.executeScript`로 그 탭 안에 GraphQL 요청 코드를 주입해서 실행 (Origin이 실제로 `https://velog.io`가 되도록)
3. `auth` 쿼리로 로그인한 사용자의 username 확인
4. Velog GraphQL API로 내 게시글 전체 목록, 시리즈 목록, 게시글-시리즈 매핑 조회
5. 게시글별 `GetStats` 요청으로 조회수 데이터 조회 (5개씩 배치 처리)
6. `series.id` 기준으로 게시글 그룹화, 시리즈별 총조회수 및 평균 조회수 계산
7. 팝업 화면에 결과 렌더링

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

## 기술 스택

- **TypeScript** — Chrome 확장 프로그램(Manifest V3) 개발 및 Velog GraphQL 응답 타입 안전성 확보
- **esbuild** — 번들링
- **Chrome Extension Manifest V3** — `service_worker` 기반 백그라운드, `cookies` / `storage` 권한 사용
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
│   │   └── statsApi.ts
│   ├── model/
│   │   ├── post.ts
│   │   ├── series.ts
│   │   └── stats.ts
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
- [ ] `src/model/*.ts` 타입 정의 작성
- [ ] `src/api/*.ts` GraphQL 클라이언트 및 요청 함수 작성
- [ ] `src/service/seriesAggregator.ts` 집계 로직 작성
- [ ] 팝업에 결과 출력

## 빌드

```bash
npm install
npm run check   # tsc --noEmit
npm run build   # esbuild 번들링 → dist/
```

`chrome://extensions` → 개발자 모드 활성화 → "압축해제된 확장 프로그램을 로드합니다" → `dist` 폴더 선택

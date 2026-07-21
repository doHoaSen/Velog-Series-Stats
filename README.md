# Velog Series Stats

Velog에 작성한 게시글의 조회수를 **시리즈별로 집계**해서 보여주는 Chrome 확장 프로그램입니다.

## 목적

Velog는 게시글별 조회수는 확인할 수 있지만, 시리즈 단위로 묶어서 총 조회수나 평균 조회수를 보여주는 기능은 제공하지 않습니다. 이 확장 프로그램은 로그인한 사용자의 게시글 목록과 조회수 데이터를 가져와 시리즈별로 그룹화하고, 시리즈별 총조회수·평균 조회수를 팝업 화면에 보여주는 것을 목표로 합니다.

## 동작 흐름

1. `chrome.cookies`로 Velog 로그인 토큰(access_token) 조회
2. Velog GraphQL API로 내 게시글 전체 목록 조회
3. 게시글별 `GetStats` 요청으로 조회수 데이터 조회
4. 게시글과 조회수 결합
5. `series.id` 기준으로 게시글 그룹화
6. 시리즈별 총조회수 및 평균 조회수 계산
7. 팝업 화면에 결과 렌더링

서버 없이 확장 프로그램 내부에서 모든 과정이 완결되도록 설계합니다 (별도 백엔드 없음).

## 기술 스택

- **TypeScript** — Chrome 확장 프로그램(Manifest V3) 개발 및 Velog GraphQL 응답 타입 안전성 확보
- **esbuild** — 번들링
- **Chrome Extension Manifest V3** — `service_worker` 기반 백그라운드, `cookies` / `storage` 권한 사용
- 프레임워크 없는 순수 DOM 조작 (초기 버전 기준, React 미사용)

## 프로젝트 구조 (예정)

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

현재 초기 설정(`package.json`, 의존성) 단계이며, 다음 순서로 구현할 예정입니다.

1. Velog `access_token` 쿠키 조회
2. GraphQL 공통 요청 함수 작성
3. 내 게시글 전체 목록 조회
4. 각 게시글 `GetStats` 조회
5. 게시글과 조회수 결합
6. `series.id` 기준 그룹화
7. 시리즈별 총조회수와 평균 계산
8. 팝업에 결과 출력

## 빌드 (예정)

```bash
npm install
npm run check   # tsc --noEmit
npm run build   # esbuild 번들링 → dist/
```

`chrome://extensions` → 개발자 모드 활성화 → "압축해제된 확장 프로그램을 로드합니다" → `dist` 폴더 선택

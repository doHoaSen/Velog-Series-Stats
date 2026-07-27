// Velog splits its GraphQL API across two hosts. Calling the wrong host for a
// given operation returns HTTP 200 with an empty body (v3) or a schema
// validation error (v2) instead of routing to the right resolver, so each
// operation must target the host that actually serves it (verified directly
// against the live API, one operation at a time).
export const VELOG_V2_ENDPOINT = "https://v2.velog.io/graphql";
export const VELOG_V3_ENDPOINT = "https://v3.velog.io/graphql";

const VELOG_URL_PATTERN = "https://velog.io/*";

interface GraphqlRequestBody<TVariables> {
  endpoint: string;
  query: string;
  variables: TVariables;
}

interface GraphqlResponse<TData> {
  data?: TData;
  errors?: Array<{ message: string }>;
}

const CONNECTION_POOL_ERROR_PATTERN = /connection pool/i;
const RETRY_DELAYS_MS = [500, 1500];

export async function requestVelogGraphql<TData, TVariables>(
  request: GraphqlRequestBody<TVariables>,
): Promise<TData> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await performGraphqlRequest<TData, TVariables>(request);
    } catch (error) {
      const isConnectionPoolError =
        error instanceof Error && CONNECTION_POOL_ERROR_PATTERN.test(error.message);
      const delayMs = RETRY_DELAYS_MS[attempt];

      // 콜드 스타트로 velog 탭을 새로 띄운 직후엔 velog 페이지 자체의 초기화 요청과
      // 우리 요청이 겹쳐 서버 커넥션 풀(한도 5)이 일시적으로 고갈될 수 있다 (2026-07-27 확인).
      // 이런 일시적 타임아웃일 때만 짧게 기다렸다가 재시도한다.
      if (!isConnectionPoolError || delayMs === undefined) {
        throw error;
      }

      await delay(delayMs);
    }
  }
}

async function performGraphqlRequest<TData, TVariables>(
  request: GraphqlRequestBody<TVariables>,
): Promise<TData> {
  const tabId = await findOrCreateVelogTab();

  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fetchGraphqlInPage,
    args: [request.endpoint, request.query, request.variables as Record<string, unknown>],
  });

  const rawBody = injectionResult?.result;

  if (typeof rawBody !== "string") {
    throw new Error("velog.io 탭에서 응답을 가져오지 못했습니다.");
  }

  let json: GraphqlResponse<TData>;

  try {
    json = JSON.parse(rawBody) as GraphqlResponse<TData>;
  } catch {
    throw new Error(`Velog GraphQL 응답을 파싱하지 못했습니다: ${rawBody.slice(0, 200)}`);
  }

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0]?.message ?? "Velog GraphQL 요청에 실패했습니다.");
  }

  if (!json.data) {
    throw new Error("Velog GraphQL 응답에 데이터가 없습니다.");
  }

  return json.data;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findOrCreateVelogTab(): Promise<number> {
  const existingTabs = await chrome.tabs.query({ url: VELOG_URL_PATTERN });
  const existing = existingTabs.find((tab) => typeof tab.id === "number");

  if (existing?.id !== undefined) {
    return existing.id;
  }

  const created = await chrome.tabs.create({ url: "https://velog.io", active: false });

  if (created.id === undefined) {
    throw new Error("velog.io 탭을 열지 못했습니다.");
  }

  await waitForTabToFinishLoading(created.id);
  return created.id;
}

function waitForTabToFinishLoading(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    function handleUpdate(updatedTabId: number, info: chrome.tabs.OnUpdatedInfo): void {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(handleUpdate);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(handleUpdate);
  });
}

function fetchGraphqlInPage(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<string> {
  return fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  }).then((response) => response.text());
}

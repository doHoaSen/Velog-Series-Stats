import { requestVelogGraphql, VELOG_V2_ENDPOINT } from "./graphqlClient";
import type { VelogUser } from "../model/user";

const GET_CURRENT_USER_QUERY = `
  query GetCurrentUser {
    auth {
      id
      username
    }
  }
`;

interface GetCurrentUserData {
  auth: VelogUser | null;
}

export async function fetchCurrentUser(): Promise<VelogUser | null> {
  const data = await requestVelogGraphql<GetCurrentUserData, Record<string, never>>({
    endpoint: VELOG_V2_ENDPOINT,
    query: GET_CURRENT_USER_QUERY,
    variables: {},
  });

  return data.auth;
}

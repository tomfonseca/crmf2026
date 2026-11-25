import createClient from "openapi-fetch";
import type { paths as AppPaths } from "./app.generated";
import type { paths as IngestPaths } from "./ingest.generated";
export type { components as AppComponents } from "./app.generated";

export function createAppClient(baseUrl: string) {
  return createClient<AppPaths>({ baseUrl });
}
export function createIngestClient(baseUrl: string) {
  return createClient<IngestPaths>({ baseUrl });
}

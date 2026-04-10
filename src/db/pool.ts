import { Pool } from "pg";

export function createPool(databaseUrl: string): Pool {
  const rejectUnauthorizedSetting = process.env.PG_SSL_REJECT_UNAUTHORIZED;
  const useExplicitSsl = typeof rejectUnauthorizedSetting === "string";
  const connectionString = useExplicitSsl ? stripSslQueryParams(databaseUrl) : databaseUrl;

  return new Pool({
    connectionString,
    ssl:
      rejectUnauthorizedSetting === undefined
        ? undefined
        : {
            rejectUnauthorized: rejectUnauthorizedSetting !== "false"
          }
  });
}

function stripSslQueryParams(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslcert");
  url.searchParams.delete("sslkey");
  url.searchParams.delete("sslrootcert");
  return url.toString();
}

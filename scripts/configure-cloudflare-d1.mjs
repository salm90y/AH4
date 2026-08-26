import { readFileSync, writeFileSync } from "node:fs";

const [listPath, configPath] = process.argv.slice(2);
if (!listPath || !configPath) throw new Error("Usage: configure-cloudflare-d1.mjs <d1-list.json> <wrangler-config>");

const databases = JSON.parse(readFileSync(listPath, "utf8"));
const database = databases.find((candidate) => candidate.name === "ah4-watch-party-rooms");
if (!database) process.exit(2);

const databaseId = database.uuid ?? database.database_id ?? database.id;
if (typeof databaseId !== "string" || !databaseId) throw new Error("D1 database ID is missing from Wrangler output.");

const config = readFileSync(configPath, "utf8").replace(
  /"database_id":\s*"[^"]+"/,
  `"database_id": "${databaseId}"`,
);
writeFileSync(configPath, config);
console.log("Configured D1 binding for deployment.");

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = process.env.GITHUB_WRITE_TOKEN;
if (!token) throw new Error("GITHUB_WRITE_TOKEN is required to publish the Cloudflare deployment.");

const repo = "salm90y/AH4";
const files = [
  ".github/workflows/android-apk.yml",
  ".github/workflows/deploy-cloudflare.yml",
  "cloudflare/src/index.mjs",
  "cloudflare/schema.sql",
  "cloudflare/wrangler.jsonc",
  "app.config.ts",
  "app/_layout.tsx",
  "components/native-media-player.tsx",
  "components/safe-launch-screen.tsx",
  "components/watch-party-app.tsx",
  "components/room-realtime-panel.native.tsx",
  "components/room-realtime-panel.web.tsx",
  "constants/oauth.ts",
  "design.md",
  "docs/cloudflare-architecture-notes.md",
  "docs/livekit-integration-notes.md",
  "docs/room-reference-review.md",
  "lib/livekit-setup.ts",
  "lib/livekit-setup.native.ts",
  "lib/livekit-setup.web.ts",
  "lib/room-api.ts",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/configure-cloudflare-d1.mjs",
  "scripts/publish-cloudflare-deployment.mjs",
  "tests/cloudflare-livekit-token.test.ts",
  "tests/cloudflare-room-worker.test.ts",
  "tests/cloudflare-token.test.ts",
  "todo.md",
];
const temporaryDirectory = mkdtempSync(join(tmpdir(), "ah4-cloudflare-publish-"));
const environment = {
  ...process.env,
  GH_TOKEN: token,
  GITHUB_TOKEN: "",
  GH_ENTERPRISE_TOKEN: "",
  GH_PAGER: "cat",
};

function gh(args) {
  const output = execFileSync("gh", args, { cwd: process.cwd(), encoding: "utf8", env: environment });
  return output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function api(method, endpoint, payload) {
  const inputPath = join(temporaryDirectory, `${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(inputPath, JSON.stringify(payload));
  try {
    return JSON.parse(gh(["api", "--method", method, endpoint, "--input", inputPath]));
  } finally {
    rmSync(inputPath, { force: true });
  }
}

try {
  const ref = JSON.parse(gh(["api", `repos/${repo}/git/ref/heads/main`]));
  const headSha = ref.object.sha;
  const headCommit = JSON.parse(gh(["api", `repos/${repo}/git/commits/${headSha}`]));

  const tree = [];
  for (const path of files) {
    const blob = api("POST", `repos/${repo}/git/blobs`, {
      content: readFileSync(path).toString("base64"),
      encoding: "base64",
    });
    tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const createdTree = api("POST", `repos/${repo}/git/trees`, { base_tree: headCommit.tree.sha, tree });
  const commit = api("POST", `repos/${repo}/git/commits`, {
    message: "feat(room-ui): match AH4 room layout to reference design",
    tree: createdTree.sha,
    parents: [headSha],
  });
  api("PATCH", `repos/${repo}/git/refs/heads/main`, { sha: commit.sha, force: false });
  console.log(`Published one commit: ${commit.sha}`);
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

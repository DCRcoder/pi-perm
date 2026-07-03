import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOperations } from "../core/operations.ts";

test("normalizeOperations expands recommended preset command patterns", () => {
  const rules = normalizeOperations({ preset: "recommended" });
  assert.equal(rules.find((rule) => rule.id === "pattern:git push").action, "confirm");
  assert.equal(rules.find((rule) => rule.id === "pattern:~/.ssh/").action, "block");
  assert.deepEqual(rules.find((rule) => rule.id === "pattern:~/.ssh/").commandIncludes, ["~/.ssh/"]);
});

test("normalizeOperations lets command patterns override preset actions", () => {
  const rules = normalizeOperations({
    preset: "recommended",
    allow: ["pnpm install"],
    block: ["git push"],
    confirm: ["gh auth token"]
  });
  assert.equal(rules.find((rule) => rule.id === "pattern:pnpm install").action, "allow");
  assert.equal(rules.find((rule) => rule.id === "pattern:git push").action, "block");
  assert.equal(rules.find((rule) => rule.id === "pattern:gh auth token").action, "confirm");
});

test("normalizeOperations expands pipe command patterns and advanced rules", () => {
  const rules = normalizeOperations({
    confirm: ["curl | sh"],
    advanced: [{ id: "deploy.prod", command: "pnpm", subcommands: ["deploy:prod"], action: "confirm" }]
  });
  assert.equal(rules.some((rule) => rule.id === "pattern:curl | sh"), true);
  assert.equal(rules.find((rule) => rule.id === "deploy.prod").command, "pnpm");
});

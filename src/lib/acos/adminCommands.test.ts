import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMAND_GROUPS, getIndividualAgents } from "./adminCommands";

const routeTree = readFileSync(resolve(__dirname, "../../routeTree.gen.ts"), "utf8");

describe("admin command catalog", () => {
  it("points every command to an existing route", () => {
    const commandPaths = COMMAND_GROUPS.flatMap((group) =>
      group.commands.map((command) => command.path),
    );
    const missing = commandPaths.filter((path) => !routeTree.includes(path));
    expect(missing).toEqual([]);
  });

  it("points every individual agent launcher to an existing route", () => {
    const missing = getIndividualAgents()
      .map((agent) => agent.path)
      .filter((path) => !routeTree.includes(path));
    expect(missing).toEqual([]);
  });
});

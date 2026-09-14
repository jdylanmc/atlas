import {
  refuseAtlasRefresh,
  type AtlasRefreshResult,
  type AtlasRefreshSelection,
} from "../operations/atlas_refresh_operation.ts";

export const atlasRefreshCommandUsage =
  "usage: atlas refresh --machine (--all | --atlas-slug SLUG) [--atlas-host-directory PATH]";

export function parseAtlasRefreshCommand(arguments_: readonly string[]):
  | {
      readonly state: "parsed";
      readonly atlasHostDirectory: string;
      readonly selection: AtlasRefreshSelection;
    }
  | { readonly state: "invalid"; readonly result: AtlasRefreshResult } {
  let machine = false;
  let selection: AtlasRefreshSelection | undefined;
  let host: string | undefined;
  const invalid = () =>
    Object.freeze({
      state: "invalid" as const,
      result: refuseAtlasRefresh("ATLAS_REFRESH_USAGE", atlasRefreshCommandUsage),
    });
  for (let index = 1; index < arguments_.length; index++) {
    const flag = arguments_[index];
    if (flag === "--machine" && !machine) machine = true;
    else if (flag === "--all" && selection === undefined)
      selection = Object.freeze({ kind: "all" });
    else if (
      (flag === "--atlas-host-directory" && host === undefined) ||
      (flag === "--atlas-slug" && selection === undefined)
    ) {
      const value = arguments_[++index];
      if (value === undefined || value.trim() === "" || value.startsWith("--"))
        return invalid();
      if (flag === "--atlas-host-directory") host = value;
      else selection = Object.freeze({ kind: "one", slug: value });
    } else return invalid();
  }
  return machine && selection !== undefined
    ? Object.freeze({ state: "parsed", atlasHostDirectory: host ?? ".", selection })
    : invalid();
}

export function exitCodeForAtlasRefresh(result: AtlasRefreshResult): number {
  if (
    result.handoff.validationState.findings.some(
      (entry) => entry.code === "ATLAS_REFRESH_USAGE",
    )
  )
    return 64;
  if (result.completion === "not-completed") return 2;
  return result.disposition === "success" ? 0 : 1;
}

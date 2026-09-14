import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SuiteArtifactOwner {
  artifact(): string;
  dispose(): void;
}

export function createSuiteArtifactOwner(
  createArtifact: (destination: string) => string,
): SuiteArtifactOwner {
  let artifact: string | undefined;
  let workspace: string | undefined;
  let disposed = false;
  return {
    artifact() {
      if (disposed) throw new Error("Suite artifact owner is disposed");
      if (artifact !== undefined) return artifact;
      workspace = mkdtempSync(join(tmpdir(), "atlas-suite-artifact-"));
      try {
        artifact = createArtifact(join(workspace, "artifact"));
        return artifact;
      } catch (error) {
        rmSync(workspace, { force: true, recursive: true });
        workspace = undefined;
        throw error;
      }
    },
    dispose() {
      if (workspace !== undefined) {
        rmSync(workspace, { force: true, recursive: true });
      }
      artifact = undefined;
      workspace = undefined;
      disposed = true;
    },
  };
}

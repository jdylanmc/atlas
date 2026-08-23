import { compareCodePoints } from "../atlas/compare_code_points.js";
import { runTrustedGit, runTrustedGitBytes } from "./trusted_git.js";
export const localAtlasSnapshotBudgets = Object.freeze({
    maxFileBytes: 1024 * 1024,
    maxFiles: 4096,
    maxTotalBytes: 16 * 1024 * 1024,
});
export function captureLocalAtlasSnapshot(repository, budgets = localAtlasSnapshotBudgets) {
    const revisionResult = runTrustedGit(repository, ["rev-parse", "HEAD"]);
    if (revisionResult.state === "failed") {
        return Object.freeze({
            reason: "Git failed while capturing the local Atlas Snapshot.",
            state: "failed",
        });
    }
    const revision = revisionResult.stdout.trim();
    const listedResult = runTrustedGit(repository, [
        "ls-tree",
        "-rz",
        "--name-only",
        revision,
        ".atlas",
    ]);
    if (listedResult.state === "failed") {
        return Object.freeze({
            reason: "Git failed while capturing the local Atlas Snapshot.",
            state: "failed",
        });
    }
    const paths = listedResult.stdout
        .split("\0")
        .filter((path) => path !== "")
        .toSorted(compareCodePoints);
    if (paths.length > budgets.maxFiles) {
        return Object.freeze({
            reason: "The local Atlas Snapshot exceeded the declared file budget.",
            state: "failed",
        });
    }
    const capturedFiles = [];
    let totalBytes = 0;
    for (const path of paths) {
        const result = runTrustedGitBytes(repository, ["show", `${revision}:${path}`]);
        if (result.state === "failed") {
            return Object.freeze({
                reason: "Git failed while reading the local Atlas Snapshot.",
                state: "failed",
            });
        }
        if (result.stdout.byteLength > budgets.maxFileBytes) {
            return Object.freeze({
                reason: "The local Atlas Snapshot exceeded the declared per-file budget.",
                state: "failed",
            });
        }
        totalBytes += result.stdout.byteLength;
        if (totalBytes > budgets.maxTotalBytes) {
            return Object.freeze({
                reason: "The local Atlas Snapshot exceeded the declared total byte budget.",
                state: "failed",
            });
        }
        capturedFiles.push(Object.freeze({ bytes: result.stdout, path }));
    }
    return Object.freeze({
        snapshot: Object.freeze({
            baseSnapshot: Object.freeze({ reference: revision, state: "known" }),
            capturedFiles: Object.freeze(capturedFiles),
            homeAtlas: Object.freeze({
                reference: "local-home-atlas",
                state: "known",
            }),
        }),
        state: "captured",
    });
}

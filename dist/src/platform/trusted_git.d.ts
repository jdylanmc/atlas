export type TrustedGitResult = {
    readonly reason: string;
    readonly state: "failed";
} | {
    readonly stdout: string;
    readonly state: "succeeded";
};
declare function runGitBytes(repository: string, args: readonly string[]): {
    readonly reason: string;
    readonly state: "failed";
} | {
    readonly stdout: Uint8Array;
    readonly state: "succeeded";
};
export declare function runTrustedGit(repository: string, args: readonly string[]): TrustedGitResult;
export declare function runTrustedGitBytes(repository: string, args: readonly string[]): ReturnType<typeof runGitBytes>;
export declare function runTrustedGitForWrite(repository: string, args: readonly string[]): TrustedGitResult;
export {};

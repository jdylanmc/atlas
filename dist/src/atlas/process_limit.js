/**
 * Re-raises a failure that describes the running process rather than the input
 * it was reading, so no check reports one as a property of an Atlas.
 *
 * Exhausting the stack or a JavaScript engine limit depends on how deep the
 * call already was and on how the engine has warmed, so the same bytes can
 * exhaust it on one call and not the next. A check that answered for it would
 * give one Atlas different verdicts on different runs, and would answer most
 * permissively exactly when it was pushed hardest. The Lint boundary answers
 * for it instead, with a verdict that claims to have read nothing.
 */
export function rethrowProcessLimit(error) {
    if (error instanceof RangeError) {
        throw error;
    }
}

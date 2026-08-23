export function compareCodePoints(left, right) {
    const leftPoints = Array.from(left, (point) => point.codePointAt(0));
    const rightPoints = Array.from(right, (point) => point.codePointAt(0));
    const length = Math.min(leftPoints.length, rightPoints.length);
    for (let index = 0; index < length; index += 1) {
        const difference = leftPoints[index] - rightPoints[index];
        if (difference !== 0) {
            return difference;
        }
    }
    return leftPoints.length - rightPoints.length;
}

import type { Matrix3, Vector3 } from '../types';

const randomMatrixEntry = () => parseFloat((Math.random() * 4 - 2).toFixed(2));

const buildRandomCandidate = (): Matrix3 => ([
    [randomMatrixEntry(), randomMatrixEntry(), randomMatrixEntry()],
    [randomMatrixEntry(), randomMatrixEntry(), randomMatrixEntry()],
    [randomMatrixEntry(), randomMatrixEntry(), randomMatrixEntry()],
]);

const determinant3x3 = (matrix: Matrix3): number => {
    const [a, b, c] = matrix[0];
    const [d, e, f] = matrix[1];
    const [g, h, i] = matrix[2];
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
};

const flipColumnSign = (matrix: Matrix3, columnIndex = 0): Matrix3 => {
    const next = matrix.map(row => [...row] as Vector3) as Matrix3;
    for (let row = 0; row < 3; row++) {
        next[row][columnIndex] *= -1;
    }
    return next;
};

export const generateRandomGLPlusMatrix = (): Matrix3 => {
    const MAX_ATTEMPTS = 30;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const candidate = buildRandomCandidate();
        const det = determinant3x3(candidate);
        if (Math.abs(det) < 1e-5) {
            continue;
        }
        if (det > 0) {
            return candidate;
        }
        return flipColumnSign(candidate);
    }

    const fallback = buildRandomCandidate();
    for (let i = 0; i < 3; i++) {
        fallback[i][i] += 1;
    }
    if (determinant3x3(fallback) <= 0) {
        return flipColumnSign(fallback);
    }
    return fallback;
};

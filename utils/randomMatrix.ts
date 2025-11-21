import type { Matrix2, Vector2 } from '../types';
import { validateExpLogMatrix } from './mathUtils';

const randomMatrixEntry = () => parseFloat((Math.random() * 4 - 2).toFixed(2));

const buildRandomCandidate = (): Matrix2 => ([
    [randomMatrixEntry(), randomMatrixEntry()],
    [randomMatrixEntry(), randomMatrixEntry()],
]);

const determinant2x2 = (matrix: Matrix2): number => {
    return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
};

const flipColumnSign = (matrix: Matrix2, columnIndex = 0): Matrix2 => {
    const next = matrix.map(row => [...row] as Vector2) as Matrix2;
    for (let row = 0; row < 2; row++) {
        next[row][columnIndex] *= -1;
    }
    return next;
};

interface RandomMatrixOptions {
    requirePositiveEigenvalues?: boolean;
}

const buildPositiveDiagonalMatrix = (): Matrix2 => ([
    [1 + Math.random(), 0],
    [0, 1 + Math.random()]
]);

export const generateRandomGLPlusMatrix = (options?: RandomMatrixOptions): Matrix2 => {
    const MAX_ATTEMPTS = 30;
    const requirePositiveEigenvalues = Boolean(options?.requirePositiveEigenvalues);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const candidate = buildRandomCandidate();
        const det = determinant2x2(candidate);
        if (Math.abs(det) < 1e-5) {
            continue;
        }
        const oriented = det > 0 ? candidate : flipColumnSign(candidate);
        if (!requirePositiveEigenvalues) {
            return oriented;
        }
        const validation = validateExpLogMatrix(oriented);
        if (validation.valid) {
            return oriented;
        }
    }

    if (requirePositiveEigenvalues) {
        return buildPositiveDiagonalMatrix();
    }

    const fallback = buildRandomCandidate();
    for (let i = 0; i < 2; i++) {
        fallback[i][i] += 1;
    }
    if (determinant2x2(fallback) <= 0) {
        return flipColumnSign(fallback);
    }
    return fallback;
};

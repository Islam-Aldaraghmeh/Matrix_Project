import type { Matrix3, Vector3 } from '../types';
import { validateExpLogMatrix } from './mathUtils';

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

interface RandomMatrixOptions {
    requirePositiveEigenvalues?: boolean;
}

const buildPositiveDiagonalMatrix = (): Matrix3 => ([
    [1 + Math.random(), 0, 0],
    [0, 1 + Math.random(), 0],
    [0, 0, 1 + Math.random()]
]);

export const generateRandomGLPlusMatrix = (options?: RandomMatrixOptions): Matrix3 => {
    const MAX_ATTEMPTS = 30;
    const requirePositiveEigenvalues = Boolean(options?.requirePositiveEigenvalues);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const candidate = buildRandomCandidate();
        const det = determinant3x3(candidate);
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
    for (let i = 0; i < 3; i++) {
        fallback[i][i] += 1;
    }
    if (determinant3x3(fallback) <= 0) {
        return flipColumnSign(fallback);
    }
    return fallback;
};

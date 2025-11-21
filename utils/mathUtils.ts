import * as math from 'mathjs';
import type { MathType } from 'mathjs';
import type { Matrix2, Vector2 } from '../types';
import type { ActivationFunction } from './activationFunctions';

const EPSILON = 1e-9;
const IMAGINARY_TOLERANCE = 1e-6;

const isComplexLike = (value: unknown): value is { re: number; im: number } => {
    return typeof value === 'object' && value !== null &&
        typeof (value as { re?: unknown }).re === 'number' &&
        typeof (value as { im?: unknown }).im === 'number';
};

const hasToNumber = (value: unknown): value is { toNumber: () => number } => {
    return typeof value === 'object' && value !== null &&
        typeof (value as { toNumber?: unknown }).toNumber === 'function';
};

const extractEigenvalueParts = (value: MathType): { real: number; imag: number } => {
    if (typeof value === 'number') {
        return { real: value, imag: 0 };
    }
    if (isComplexLike(value)) {
        return { real: value.re, imag: value.im };
    }
    if (hasToNumber(value)) {
        const real = value.toNumber();
        return { real, imag: 0 };
    }
    const parsed = Number(value as number);
    return {
        real: Number.isFinite(parsed) ? parsed : NaN,
        imag: 0
    };
};

const isExpLogEigenvalueAllowed = (value: MathType): boolean => {
    const { real, imag } = extractEigenvalueParts(value);
    if (!Number.isFinite(real) || !Number.isFinite(imag)) {
        return false;
    }
    if (Math.abs(imag) > IMAGINARY_TOLERANCE) {
        return true;
    }
    return real > EPSILON;
};

const eigenvaluesAreExpLogSafe = (values: MathType[]): boolean =>
    values.every(isExpLogEigenvalueAllowed);

export type ExpLogValidationResult = {
    valid: boolean;
    reason: string | null;
};

const identityMatrix = (): Matrix2 => [
    [1, 0],
    [0, 1],
];

const cloneMatrix = (m: Matrix2): Matrix2 => [
    [m[0][0], m[0][1]],
    [m[1][0], m[1][1]],
];

const matrixMultiply = (a: Matrix2, b: Matrix2): Matrix2 => {
    const result: Matrix2 = [
        [0, 0],
        [0, 0],
    ];
    for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
            let sum = 0;
            for (let k = 0; k < 2; k++) {
                sum += a[i][k] * b[k][j];
            }
            result[i][j] = sum;
        }
    }
    return result;
};

const matrixAdd = (a: Matrix2, b: Matrix2): Matrix2 => [
    [a[0][0] + b[0][0], a[0][1] + b[0][1]],
    [a[1][0] + b[1][0], a[1][1] + b[1][1]],
];

const matrixSubtract = (a: Matrix2, b: Matrix2): Matrix2 => [
    [a[0][0] - b[0][0], a[0][1] - b[0][1]],
    [a[1][0] - b[1][0], a[1][1] - b[1][1]],
];

const scaleMatrix = (m: Matrix2, scalar: number): Matrix2 => [
    [m[0][0] * scalar, m[0][1] * scalar],
    [m[1][0] * scalar, m[1][1] * scalar],
];

const transposeMatrix = (m: Matrix2): Matrix2 => [
    [m[0][0], m[1][0]],
    [m[0][1], m[1][1]],
];

const determinant2 = (m: Matrix2): number => (m[0][0] * m[1][1]) - (m[0][1] * m[1][0]);

const diagMatrix = (values: Vector2): Matrix2 => [
    [values[0], 0],
    [0, values[1]],
];

const vectorNorm = (v: Vector2): number =>
    Math.hypot(v[0], v[1]);

const normalizeVector = (v: Vector2): Vector2 => {
    const length = vectorNorm(v);
    if (length < EPSILON) {
        return [1, 0];
    }
    return [v[0] / length, v[1] / length];
};

const rotationMatrixFromAngle = (angle: number): Matrix2 => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
        [c, -s],
        [s, c],
    ];
};

const toFiniteNumber = (value: unknown): number => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
    }
    if (typeof value === 'object' && value !== null) {
        if ('re' in value && 'im' in value) {
            const complex = value as math.Complex;
            if (Math.abs(complex.im) > IMAGINARY_TOLERANCE) {
                console.warn('Dropping imaginary component during matrix conversion:', complex.im);
            }
            return complex.re;
        }
        if ('toNumber' in value && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
            return (value as { toNumber: () => number }).toNumber();
        }
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
};

const toMatrix2 = (value: math.Matrix | (number | math.Complex | math.BigNumber)[][]): Matrix2 => {
    const arr = Array.isArray(value) ? value : (value.toArray() as (number | math.Complex | math.BigNumber)[][]);
    return [
        [toFiniteNumber(arr[0][0]), toFiniteNumber(arr[0][1])],
        [toFiniteNumber(arr[1][0]), toFiniteNumber(arr[1][1])],
    ];
};

const applySignCorrection = (Q: Matrix2, R: Matrix2) => {
    const diagSigns: Vector2 = [
        R[0][0] >= 0 ? 1 : -1,
        R[1][1] >= 0 ? 1 : -1,
    ];

    const adjustedQ = cloneMatrix(Q);
    const adjustedR = cloneMatrix(R);

    for (let col = 0; col < 2; col++) {
        const sign = diagSigns[col];
        if (sign < 0) {
            for (let row = 0; row < 2; row++) {
                adjustedQ[row][col] *= sign;
            }
        }
    }

    for (let row = 0; row < 2; row++) {
        const sign = diagSigns[row];
        if (sign < 0) {
            for (let col = 0; col < 2; col++) {
                adjustedR[row][col] *= sign;
            }
        }
    }

    if (determinant2(adjustedQ) < 0) {
        for (let row = 0; row < 2; row++) {
            adjustedQ[row][1] *= -1;
        }
        for (let col = 0; col < 2; col++) {
            adjustedR[1][col] *= -1;
        }
    }

    return { Q: adjustedQ, R: adjustedR };
};

const extractRotationGenerator = (Q: Matrix2) => {
    const angle = Math.atan2(Q[1][0], Q[0][0]);
    const logQ: Matrix2 = [
        [0, -angle],
        [angle, 0],
    ];
    return { angle, logQ };
};

const computeUnitUpperGenerators = (U: Matrix2) => {
    const offDiag = U[0][1];
    const logU: Matrix2 = [
        [0, offDiag],
        [0, 0],
    ];
    const logUSquared: Matrix2 = [
        [0, 0],
        [0, 0],
    ];
    return { logU, logUSquared };
};

interface KanPathData {
    rotationAngle: number;
    logQ: Matrix2;
    logD: Matrix2;
    logU: Matrix2;
    logUSquared: Matrix2;
    diagLogs: Vector2;
}

const optionKey = (options?: TransformOptions): string =>
    options?.linearEigenInterpolation ? 'linear' : 'pow';

const timeKey = (t: number): number => (Number.isFinite(t) ? Number(t.toFixed(6)) : NaN);

export interface TransformOptions {
    linearEigenInterpolation?: boolean;
}

export const interpolateEigenvalue = (
    value: number | math.Complex,
    t: number,
    options?: TransformOptions
): number | math.Complex => {
    if (options?.linearEigenInterpolation) {
        return math.add(
            math.multiply(value, t),
            math.multiply(1 - t, 1)
        ) as number | math.Complex;
    }
    return math.pow(value, t) as number | math.Complex;
};

export const multiplyMatrixVector = (matrix: Matrix2, vector: Vector2): Vector2 => {
    const [x, y] = vector;
    return [
        matrix[0][0] * x + matrix[0][1] * y,
        matrix[1][0] * x + matrix[1][1] * y,
    ];
};

const buildKanPath = (A: Matrix2): KanPathData | null => {
    const detA = determinant2(A);
    if (!Number.isFinite(detA) || detA <= 0) {
        return null;
    }

    const qr = math.qr(math.matrix(A));
    const rawQ = toMatrix2(qr.Q);
    const rawR = toMatrix2(qr.R);
    const { Q, R } = applySignCorrection(rawQ, rawR);

    const diagValues: Vector2 = [R[0][0], R[1][1]];
    if (diagValues.some(value => !Number.isFinite(value) || value <= 0)) {
        return null;
    }

    const D = diagMatrix(diagValues);
    const Dinv = diagMatrix([
        1 / diagValues[0],
        1 / diagValues[1],
    ]);

    const U = matrixMultiply(Dinv, R);

    const { angle, logQ } = extractRotationGenerator(Q);
    const logD = diagMatrix([
        Math.log(diagValues[0]),
        Math.log(diagValues[1]),
    ]);
    const diagLogs: Vector2 = [
        logD[0][0],
        logD[1][1],
    ];
    const { logU, logUSquared } = computeUnitUpperGenerators(U);

    return {
        rotationAngle: angle,
        logQ,
        logD,
        logU,
        logUSquared,
        diagLogs,
    };
};

const evaluateKanPath = (t: number, data: KanPathData): Matrix2 | null => {
    if (!Number.isFinite(t)) return null;

    const Qt = rotationMatrixFromAngle(data.rotationAngle * t);
    const Dt = diagMatrix([
        Math.exp(data.diagLogs[0] * t),
        Math.exp(data.diagLogs[1] * t),
    ]);

    const identity = identityMatrix();
    const tLogU = scaleMatrix(data.logU, t);
    const t2 = 0.5 * t * t;
    const logUSquaredTerm = scaleMatrix(data.logUSquared, t2);
    const Ut = matrixAdd(identity, matrixAdd(tLogU, logUSquaredTerm));

    return matrixMultiply(matrixMultiply(Qt, Dt), Ut);
};

export interface MatrixEvaluator {
    eigenValues: (number | math.Complex)[];
    getMatrixAt: (t: number, options?: TransformOptions) => Matrix2 | null;
    applyToVector: (t: number, v: Vector2, options?: TransformOptions) => Vector2 | null;
}

export type MatrixBackend = 'kan' | 'exp-log';

const createKanEvaluator = (A: Matrix2): MatrixEvaluator | null => {
    try {
        const pathData = buildKanPath(A);
        if (!pathData) {
            return null;
        }

        let eigenValues: (number | math.Complex)[] = [];
        try {
            const eigs = math.eigs(math.matrix(A));
            if (eigs.values) {
                eigenValues = math.matrix(eigs.values).toArray() as (number | math.Complex)[];
            }
        } catch (error) {
            console.warn('Eigenvalue computation failed:', error);
        }

        const cache = new Map<string, Map<number, Matrix2>>();

        const getOrCreateMatrix = (t: number, options?: TransformOptions): Matrix2 | null => {
            const k = optionKey(options);
            const optionCache = cache.get(k) ?? new Map<number, Matrix2>();
            if (!cache.has(k)) {
                cache.set(k, optionCache);
            }
            const tKey = timeKey(t);
            if (!Number.isFinite(tKey)) {
                return null;
            }
            if (optionCache.has(tKey)) {
                return optionCache.get(tKey)!;
            }

            const evaluated = evaluateKanPath(t, pathData);
            if (!evaluated) {
                return null;
            }
            optionCache.set(tKey, evaluated);
            return evaluated;
        };

        const applyToVector = (t: number, v: Vector2, options?: TransformOptions): Vector2 | null => {
            const mat = getOrCreateMatrix(t, options);
            if (!mat) {
                return null;
            }
            return multiplyMatrixVector(mat, v);
        };

        return {
            eigenValues,
            getMatrixAt: getOrCreateMatrix,
            applyToVector,
        };
    } catch (error) {
        console.error('Matrix evaluator error:', error);
        return null;
    }
};

const createExpLogEvaluator = (A: Matrix2): MatrixEvaluator | null => {
    try {
        const detA = determinant2(A);
        if (!Number.isFinite(detA) || Math.abs(detA) < EPSILON) {
            console.warn('Exp-log backend requires an invertible matrix.');
            return null;
        }

        const eigResult = math.eigs(math.matrix(A));
        const eigenvectorEntries =
            (eigResult as unknown as { eigenvectors?: { vector: math.Matrix }[] }).eigenvectors ||
            (eigResult as unknown as { vectors?: { vector: math.Matrix }[] }).vectors;
        if (!eigResult.values || !Array.isArray(eigenvectorEntries)) {
            return null;
        }
        const eigenValues = (math.matrix(eigResult.values).toArray() as (number | math.Complex)[]);

        const hasZeroEigen = eigenValues.some(value => {
            if (typeof value === 'number') {
                return Math.abs(value) < EPSILON;
            }
            const complex = value as math.Complex;
            return Math.hypot(complex.re, complex.im) < EPSILON;
        });
        if (hasZeroEigen) {
            console.warn('Exp-log backend requires eigenvalues with non-zero magnitude.');
            return null;
        }
        if (!eigenvaluesAreExpLogSafe(eigenValues as MathType[])) {
            console.warn('Exp-log backend requires strictly positive real eigenvalues or complex conjugate pairs.');
            return null;
        }

        const logDiagValues = eigenValues.map(value => math.log(value as math.MathType));
        const logDiag = math.diag(logDiagValues);
        const columnVectors = eigenvectorEntries.map(entry => {
            const vectorArray = typeof entry.vector?.toArray === 'function'
                ? entry.vector.toArray()
                : entry.vector;
            if (Array.isArray(vectorArray) && Array.isArray(vectorArray[0]) && vectorArray[0].length === 1) {
                return vectorArray.map((row: [math.MathType]) => row[0]);
            }
            return vectorArray;
        });
        if (columnVectors.length === 0) {
            return null;
        }
        const dimension = Array.isArray(columnVectors[0]) ? columnVectors[0].length : 0;
        if (dimension === 0 || columnVectors.some(col => !Array.isArray(col) || col.length !== dimension)) {
            console.warn('Invalid eigenvector data for exp-log backend');
            return null;
        }
        const Vdata = Array.from({ length: dimension }, (_, rowIndex) =>
            columnVectors.map(col => col[rowIndex])
        );
        const V = math.matrix(Vdata);
        const Vinv = math.inv(V);
        const logMatrix = math.multiply(V, math.multiply(logDiag, Vinv)) as math.Matrix;

        const cache = new Map<number, Matrix2>();
        const getMatrixAt = (t: number): Matrix2 | null => {
            const tKey = timeKey(t);
            if (!Number.isFinite(tKey)) return null;
            if (cache.has(tKey)) {
                return cache.get(tKey)!;
            }
            const scaled = math.multiply(logMatrix, t) as math.Matrix;
            const expResult = math.expm(scaled) as math.Matrix;
            const matrix = toMatrix2(expResult);
            cache.set(tKey, matrix);
            return matrix;
        };

        const applyToVector = (t: number, v: Vector2): Vector2 | null => {
            const mat = getMatrixAt(t);
            if (!mat) return null;
            return multiplyMatrixVector(mat, v);
        };

        return {
            eigenValues,
            getMatrixAt: (t: number, _options?: TransformOptions) => getMatrixAt(t),
            applyToVector: (t: number, v: Vector2, _options?: TransformOptions) => applyToVector(t, v),
        };
    } catch (error) {
        console.error('Exp-log evaluator error:', error);
        return null;
    }
};

export function createMatrixEvaluator(A: Matrix2, backend: MatrixBackend = 'kan'): MatrixEvaluator | null {
    if (backend === 'exp-log') {
        return createExpLogEvaluator(A);
    }
    return createKanEvaluator(A);
}

export function calculateAt(
    A: Matrix2,
    t: number,
    options: TransformOptions = {},
    backend: MatrixBackend = 'kan'
): Matrix2 | null {
    const evaluator = createMatrixEvaluator(A, backend);
    return evaluator ? evaluator.getMatrixAt(t, options) : null;
}

export function calculateAtvRaw(
    A: Matrix2,
    v: Vector2,
    t: number,
    options: TransformOptions = {},
    backend: MatrixBackend = 'kan'
): Vector2 | null {
    const evaluator = createMatrixEvaluator(A, backend);
    return evaluator ? evaluator.applyToVector(t, v, options) : null;
}

export function calculateAtv(
    A: Matrix2,
    v: Vector2,
    t: number,
    activationFn: ActivationFunction,
    options: TransformOptions = {},
    backend: MatrixBackend = 'kan'
): Vector2 | null {
    const evaluator = createMatrixEvaluator(A, backend);
    if (!evaluator) return null;
    const raw = evaluator.applyToVector(t, v, options);
    if (!raw) return null;
    return raw.map(activationFn) as Vector2;
}

export const validateExpLogMatrix = (matrix: Matrix2): ExpLogValidationResult => {
    try {
        const eigs = math.eigs(math.matrix(matrix));
        if (!eigs.values) {
            return {
                valid: false,
                reason: 'exp(t ln A) requires computable eigenvalues.'
            };
        }
        const eigenValues = math.matrix(eigs.values).toArray() as MathType[];
        if (!eigenvaluesAreExpLogSafe(eigenValues)) {
            return {
                valid: false,
                reason: 'exp(t ln A) requires strictly positive real eigenvalues (complex conjugate pairs are allowed).'
            };
        }
        return { valid: true, reason: null };
    } catch (error) {
        console.warn('Exp-log validation error:', error);
        return {
            valid: false,
            reason: 'exp(t ln A) requires positive real eigenvalues or complex conjugate pairs.'
        };
    }
};

import * as math from 'mathjs';
import type { MathType } from 'mathjs';
import type { Matrix3, Vector3 } from '../types';
import type { ActivationFunction } from './activationFunctions';

const EPSILON = 1e-9;
const SMALL_ANGLE = 1e-7;
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

const identityMatrix = (): Matrix3 => [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
];

const cloneMatrix = (m: Matrix3): Matrix3 => [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]],
    [m[2][0], m[2][1], m[2][2]],
];

const matrixMultiply = (a: Matrix3, b: Matrix3): Matrix3 => {
    const result: Matrix3 = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let sum = 0;
            for (let k = 0; k < 3; k++) {
                sum += a[i][k] * b[k][j];
            }
            result[i][j] = sum;
        }
    }
    return result;
};

const matrixAdd = (a: Matrix3, b: Matrix3): Matrix3 => [
    [a[0][0] + b[0][0], a[0][1] + b[0][1], a[0][2] + b[0][2]],
    [a[1][0] + b[1][0], a[1][1] + b[1][1], a[1][2] + b[1][2]],
    [a[2][0] + b[2][0], a[2][1] + b[2][1], a[2][2] + b[2][2]],
];

const matrixSubtract = (a: Matrix3, b: Matrix3): Matrix3 => [
    [a[0][0] - b[0][0], a[0][1] - b[0][1], a[0][2] - b[0][2]],
    [a[1][0] - b[1][0], a[1][1] - b[1][1], a[1][2] - b[1][2]],
    [a[2][0] - b[2][0], a[2][1] - b[2][1], a[2][2] - b[2][2]],
];

const scaleMatrix = (m: Matrix3, scalar: number): Matrix3 => [
    [m[0][0] * scalar, m[0][1] * scalar, m[0][2] * scalar],
    [m[1][0] * scalar, m[1][1] * scalar, m[1][2] * scalar],
    [m[2][0] * scalar, m[2][1] * scalar, m[2][2] * scalar],
];

const transposeMatrix = (m: Matrix3): Matrix3 => [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
];

const determinant3 = (m: Matrix3): number => {
    const [a, b, c] = m[0];
    const [d, e, f] = m[1];
    const [g, h, i] = m[2];
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
};

const diagMatrix = (values: Vector3): Matrix3 => [
    [values[0], 0, 0],
    [0, values[1], 0],
    [0, 0, values[2]],
];

const skewMatrix = (axis: Vector3): Matrix3 => [
    [0, -axis[2], axis[1]],
    [axis[2], 0, -axis[0]],
    [-axis[1], axis[0], 0],
];

const axisFromSkew = (skew: Matrix3): Vector3 => [
    skew[2][1],
    skew[0][2],
    skew[1][0],
];

const vectorNorm = (v: Vector3): number =>
    Math.hypot(v[0], v[1], v[2]);

const normalizeVector = (v: Vector3): Vector3 => {
    const length = vectorNorm(v);
    if (length < EPSILON) {
        return [1, 0, 0];
    }
    return [v[0] / length, v[1] / length, v[2] / length];
};

const rotationMatrixFromAxisAngle = (axis: Vector3, angle: number): Matrix3 => {
    if (Math.abs(angle) < SMALL_ANGLE) {
        const identity = identityMatrix();
        const skew = skewMatrix(axis);
        const scaled = scaleMatrix(skew, angle);
        const half = scaleMatrix(matrixMultiply(scaled, scaled), 0.5);
        return matrixAdd(identity, matrixAdd(scaled, half));
    }

    const [ux, uy, uz] = normalizeVector(axis);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const oneMinusC = 1 - c;

    return [
        [
            c + ux * ux * oneMinusC,
            ux * uy * oneMinusC - uz * s,
            ux * uz * oneMinusC + uy * s,
        ],
        [
            uy * ux * oneMinusC + uz * s,
            c + uy * uy * oneMinusC,
            uy * uz * oneMinusC - ux * s,
        ],
        [
            uz * ux * oneMinusC - uy * s,
            uz * uy * oneMinusC + ux * s,
            c + uz * uz * oneMinusC,
        ],
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

const toMatrix3 = (value: math.Matrix | (number | math.Complex | math.BigNumber)[][]): Matrix3 => {
    const arr = Array.isArray(value) ? value : (value.toArray() as (number | math.Complex | math.BigNumber)[][]);
    return [
        [toFiniteNumber(arr[0][0]), toFiniteNumber(arr[0][1]), toFiniteNumber(arr[0][2])],
        [toFiniteNumber(arr[1][0]), toFiniteNumber(arr[1][1]), toFiniteNumber(arr[1][2])],
        [toFiniteNumber(arr[2][0]), toFiniteNumber(arr[2][1]), toFiniteNumber(arr[2][2])],
    ];
};

const applySignCorrection = (Q: Matrix3, R: Matrix3) => {
    const diagSigns: Vector3 = [
        R[0][0] >= 0 ? 1 : -1,
        R[1][1] >= 0 ? 1 : -1,
        R[2][2] >= 0 ? 1 : -1,
    ];

    const adjustedQ = cloneMatrix(Q);
    const adjustedR = cloneMatrix(R);

    for (let col = 0; col < 3; col++) {
        const sign = diagSigns[col];
        if (sign < 0) {
            for (let row = 0; row < 3; row++) {
                adjustedQ[row][col] *= sign;
            }
        }
    }

    for (let row = 0; row < 3; row++) {
        const sign = diagSigns[row];
        if (sign < 0) {
            for (let col = 0; col < 3; col++) {
                adjustedR[row][col] *= sign;
            }
        }
    }

    if (determinant3(adjustedQ) < 0) {
        for (let row = 0; row < 3; row++) {
            adjustedQ[row][2] *= -1;
        }
        for (let col = 0; col < 3; col++) {
            adjustedR[2][col] *= -1;
        }
    }

    return { Q: adjustedQ, R: adjustedR };
};

const extractRotationGenerator = (Q: Matrix3) => {
    const trace = Q[0][0] + Q[1][1] + Q[2][2];
    const cosTheta = Math.min(1, Math.max(-1, (trace - 1) / 2));
    let theta = Math.acos(cosTheta);
    let axis: Vector3;

    if (theta < SMALL_ANGLE) {
        const skewApprox = scaleMatrix(matrixSubtract(Q, transposeMatrix(Q)), 0.5);
        const axisCandidate = axisFromSkew(skewApprox);
        const length = vectorNorm(axisCandidate);
        axis = length > EPSILON ? (axisCandidate.map(v => v / length) as Vector3) : [1, 0, 0];
        theta = Math.max(theta, length);
    } else if (Math.abs(Math.PI - theta) < 1e-4) {
        const diag = [Q[0][0], Q[1][1], Q[2][2]];
        let index = 0;
        if (diag[1] > diag[index]) index = 1;
        if (diag[2] > diag[index]) index = 2;
        let axisCandidate: Vector3;
        if (index === 0) {
            axisCandidate = [Q[0][0] + 1, Q[1][0], Q[2][0]];
        } else if (index === 1) {
            axisCandidate = [Q[0][1], Q[1][1] + 1, Q[2][1]];
        } else {
            axisCandidate = [Q[0][2], Q[1][2], Q[2][2] + 1];
        }
        axis = normalizeVector(axisCandidate);
    } else {
        const denom = 2 * Math.sin(theta);
        axis = [
            (Q[2][1] - Q[1][2]) / denom,
            (Q[0][2] - Q[2][0]) / denom,
            (Q[1][0] - Q[0][1]) / denom,
        ];
        axis = normalizeVector(axis);
    }

    const logQ = scaleMatrix(skewMatrix(axis), theta);
    return { axis, angle: theta, logQ };
};

const computeUnitUpperGenerators = (U: Matrix3) => {
    const identity = identityMatrix();
    const K = matrixSubtract(U, identity);
    const K2 = matrixMultiply(K, K);
    const logU = matrixSubtract(K, scaleMatrix(K2, 0.5));
    const logUSquared = matrixMultiply(logU, logU);
    return { logU, logUSquared };
};

interface KanPathData {
    rotationAxis: Vector3;
    rotationAngle: number;
    logQ: Matrix3;
    logD: Matrix3;
    logU: Matrix3;
    logUSquared: Matrix3;
    diagLogs: Vector3;
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

export const multiplyMatrixVector = (matrix: Matrix3, vector: Vector3): Vector3 => {
    const [x, y, z] = vector;
    return [
        matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
        matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
        matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z,
    ];
};

const buildKanPath = (A: Matrix3): KanPathData | null => {
    const detA = determinant3(A);
    if (!Number.isFinite(detA) || detA <= 0) {
        return null;
    }

    const qr = math.qr(math.matrix(A));
    const rawQ = toMatrix3(qr.Q);
    const rawR = toMatrix3(qr.R);
    const { Q, R } = applySignCorrection(rawQ, rawR);

    const diagValues: Vector3 = [R[0][0], R[1][1], R[2][2]];
    if (diagValues.some(value => !Number.isFinite(value) || value <= 0)) {
        return null;
    }

    const D = diagMatrix(diagValues);
    const Dinv = diagMatrix([
        1 / diagValues[0],
        1 / diagValues[1],
        1 / diagValues[2],
    ]);

    const U = matrixMultiply(Dinv, R);

    const { axis, angle, logQ } = extractRotationGenerator(Q);
    const logD = diagMatrix([
        Math.log(diagValues[0]),
        Math.log(diagValues[1]),
        Math.log(diagValues[2]),
    ]);
    const diagLogs: Vector3 = [
        logD[0][0],
        logD[1][1],
        logD[2][2],
    ];
    const { logU, logUSquared } = computeUnitUpperGenerators(U);

    return {
        rotationAxis: axis,
        rotationAngle: angle,
        logQ,
        logD,
        logU,
        logUSquared,
        diagLogs,
    };
};

const evaluateKanPath = (t: number, data: KanPathData): Matrix3 | null => {
    if (!Number.isFinite(t)) return null;

    const Qt = rotationMatrixFromAxisAngle(data.rotationAxis, data.rotationAngle * t);
    const Dt = diagMatrix([
        Math.exp(data.diagLogs[0] * t),
        Math.exp(data.diagLogs[1] * t),
        Math.exp(data.diagLogs[2] * t),
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
    getMatrixAt: (t: number, options?: TransformOptions) => Matrix3 | null;
    applyToVector: (t: number, v: Vector3, options?: TransformOptions) => Vector3 | null;
}

export type MatrixBackend = 'kan' | 'exp-log';

const createKanEvaluator = (A: Matrix3): MatrixEvaluator | null => {
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

        const cache = new Map<string, Map<number, Matrix3>>();

        const getOrCreateMatrix = (t: number, options?: TransformOptions): Matrix3 | null => {
            const k = optionKey(options);
            const optionCache = cache.get(k) ?? new Map<number, Matrix3>();
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

        const applyToVector = (t: number, v: Vector3, options?: TransformOptions): Vector3 | null => {
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

const createExpLogEvaluator = (A: Matrix3): MatrixEvaluator | null => {
    try {
        const detA = determinant3(A);
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

        const cache = new Map<number, Matrix3>();
        const getMatrixAt = (t: number): Matrix3 | null => {
            const tKey = timeKey(t);
            if (!Number.isFinite(tKey)) return null;
            if (cache.has(tKey)) {
                return cache.get(tKey)!;
            }
            const scaled = math.multiply(logMatrix, t) as math.Matrix;
            const expResult = math.expm(scaled) as math.Matrix;
            const matrix = toMatrix3(expResult);
            cache.set(tKey, matrix);
            return matrix;
        };

        const applyToVector = (t: number, v: Vector3): Vector3 | null => {
            const mat = getMatrixAt(t);
            if (!mat) return null;
            return multiplyMatrixVector(mat, v);
        };

        return {
            eigenValues,
            getMatrixAt: (t: number, _options?: TransformOptions) => getMatrixAt(t),
            applyToVector: (t: number, v: Vector3, _options?: TransformOptions) => applyToVector(t, v),
        };
    } catch (error) {
        console.error('Exp-log evaluator error:', error);
        return null;
    }
};

export function createMatrixEvaluator(A: Matrix3, backend: MatrixBackend = 'kan'): MatrixEvaluator | null {
    if (backend === 'exp-log') {
        return createExpLogEvaluator(A);
    }
    return createKanEvaluator(A);
}

export function calculateAt(
    A: Matrix3,
    t: number,
    options: TransformOptions = {},
    backend: MatrixBackend = 'kan'
): Matrix3 | null {
    const evaluator = createMatrixEvaluator(A, backend);
    return evaluator ? evaluator.getMatrixAt(t, options) : null;
}

export function calculateAtvRaw(
    A: Matrix3,
    v: Vector3,
    t: number,
    options: TransformOptions = {},
    backend: MatrixBackend = 'kan'
): Vector3 | null {
    const evaluator = createMatrixEvaluator(A, backend);
    return evaluator ? evaluator.applyToVector(t, v, options) : null;
}

export function calculateAtv(
    A: Matrix3,
    v: Vector3,
    t: number,
    activationFn: ActivationFunction,
    options: TransformOptions = {},
    backend: MatrixBackend = 'kan'
): Vector3 | null {
    const evaluator = createMatrixEvaluator(A, backend);
    if (!evaluator) return null;
    const raw = evaluator.applyToVector(t, v, options);
    if (!raw) return null;
    return raw.map(activationFn) as Vector3;
}

export const validateExpLogMatrix = (matrix: Matrix3): ExpLogValidationResult => {
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

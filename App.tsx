import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as math from 'mathjs';
import Scene from './components/Scene';
import ControlsPanel, { type ControlsPanelTab } from './components/ControlsPanel';
import InfoPanel from './components/InfoPanel';
import GuidedTour, { type TourStep } from './components/GuidedTour';
import { createMatrixEvaluator, multiplyMatrixVector, validateExpLogMatrix } from './utils/mathUtils';
import type { ExpLogValidationResult, MatrixBackend } from './utils/mathUtils';
import { easingFunctions } from './utils/easing';
import { activationFunctionMap, parseCustomActivation } from './utils/activationFunctions';
import { generateRandomGLPlusMatrix } from './utils/randomMatrix';
import type { ActivationFunction } from './utils/activationFunctions';
import type { Matrix2, Vector2, VectorObject, Wall, FadingPathStyle, Point2, SceneVectorEntry } from './types';
import {
    listProfiles,
    loadProfile as loadStoredProfile,
    saveProfile as persistProfile,
    deleteProfile as removeStoredProfile,
    loadLastSession,
    saveLastSession,
    loadLastUsedProfile,
    saveLastUsedProfile,
    getProfileVersion,
    type ProfileData,
    type ProfileSummary,
    type ProfileOperationResult
} from './utils/profileStorage';

// --- CONSTANTS ---

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const INITIAL_MATRIX: Matrix2 = [
    [Math.cos(2), -Math.sin(2)],
    [Math.sin(2), Math.cos(2)]
];

export const PRESET_MATRICES: { name: string; matrix: Matrix2 }[] = [
    { name: "Rotation (2 rad)", matrix: INITIAL_MATRIX },
    { name: "Shear X", matrix: [[1, 1], [0, 1]] },
    { name: "Shear Y", matrix: [[1, 0], [1, 1]] },
    { name: "Scale (Uniform)", matrix: [[1.5, 0], [0, 1.5]] },
    { name: "Scale (Non-uniform)", matrix: [[1.5, 0], [0, 0.5]] },
    { name: "Spiral Sink", matrix: [[0.9, -0.6], [0.6, 0.9]] },
    { name: "Spiral Source", matrix: [[1.1, -0.6], [0.6, 1.1]] },
    { name: "Saddle Point", matrix: [[1.2, 0], [0, 0.8]] },
    { name: "Custom", matrix: [[1, 0], [0, 1]] }
];


const VECTOR_COLORS = ['#f87171', '#60a5fa', '#facc15', '#4ade80', '#a78bfa', '#fb923c'];

const INITIAL_VECTORS: VectorObject[] = [
    { id: Date.now(), value: [2, 0], visible: true, color: VECTOR_COLORS[0] }
];

const DOT_SIZE_DEFAULT = 0.08;
const DOT_SIZE_MIN = 0.02;
const DOT_SIZE_MAX = 0.2;

const BACKEND_LABELS: Record<MatrixBackend, string> = {
    kan: 'KAN Path',
    'exp-log': 'exp(t ln A) Path'
};

const BACKEND_COLORS: Record<MatrixBackend, string> = {
    kan: '#22d3ee',
    'exp-log': '#f97316'
};

const TOUR_STEPS: TourStep[] = [
    {
        id: 'layout',
        title: 'Welcome to the interactive tour',
        description: 'This left panel holds every control for the visualizer. Everything stays clickable while the tour runs—use Skip Tour any time to exit on purpose.',
        selector: '[data-tour-id="tour-controls"]',
        tab: 'controls',
        spotlightPadding: 14
    },
    {
        id: 'scene',
        title: '2D plane: follow the paths',
        description: 'Watch the trajectories update as t changes. Hit Play to see how the vectors sweep the plane and light up wall contacts.',
        selector: '[data-tour-id="tour-scene"]',
        tab: 'controls'
    },
    {
        id: 'matrix',
        title: 'Set up A or randomize',
        description: 'Choose presets or press Random to sample a new matrix. For fair backend comparisons, keep exp(t ln A) eligible (positive real eigenvalues).',
        selector: '[data-tour-id="tour-matrix"]',
        tab: 'controls'
    },
    {
        id: 'backend',
        title: 'Pick and compare backends',
        description: 'In the Config tab, choose KAN or exp(t ln A). Toggle Compare Backends to plot both paths together on the same random matrix.',
        selector: '[data-tour-id="tour-backend"]',
        tab: 'animation'
    },
    {
        id: 'playback',
        title: 'Animate and explore',
        description: 'Use Play/Pause or Explore to ping-pong through t. Explore will keep randomizing matrices (and vectors if you want) so you can watch both backends update.',
        selector: '[data-tour-id="tour-playback"]',
        tab: 'animation'
    },
    {
        id: 'vectors',
        title: 'Shape the input vectors',
        description: 'Add, recolor, toggle visibility, and normalize vectors. These are the starting points whose trajectories you compare between backends.',
        selector: '[data-tour-id="tour-vectors"]',
        tab: 'controls'
    },
    {
        id: 'parameter',
        title: 'Time control',
        description: 'Scrub t, clamp its range, and tune the sampling precision to inspect how A^t acts on each vector at any instant.',
        selector: '[data-tour-id="tour-parameter"]',
        tab: 'controls'
    },
    {
        id: 'activation',
        title: 'Activation transforms',
        description: 'Apply preset or custom activation functions to A^t v. Combine with backend comparison to see how nonlinear choices bend the paths.',
        selector: '[data-tour-id="tour-activation"]',
        tab: 'animation'
    },
    {
        id: 'walls',
        title: 'Collision walls',
        description: 'Add axis-aligned lines to flag contact points. Handy when you want to see how each backend pushes vectors against boundaries.',
        selector: '[data-tour-id="tour-walls"]',
        tab: 'walls'
    },
    {
        id: 'info',
        title: 'Diagnostics panel',
        description: 'Monitor eigenvalues, determinants, and the current A^t and f(A^t v). Use this to verify random matrices are valid for exp(t ln A).',
        selector: '[data-tour-id="tour-info"]',
        tab: 'none',
        spotlightPadding: 10
    },
    {
        id: 'profiles',
        title: 'Save and reload scenarios',
        description: 'Store setups while experimenting with both backends. Save profiles for matrices you like, reload them, and continue comparing paths.',
        selector: '[data-tour-id="tour-profiles"]',
        tab: 'profiles'
    }
];

const randomVector = (nonNegative = false): Vector2 => {
    const base: Vector2 = [
        Math.random() * 4 - 2,
        Math.random() * 4 - 2
    ];
    if (!nonNegative) {
        return base;
    }
    return base.map(component => Math.abs(component)) as Vector2;
};

const normalizeVectorValue = (value: Vector2): Vector2 => {
    const [x, y] = value;
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length === 0) {
        return [x, y];
    }
    return [x / length, y / length];
};

const normalizeVectorObject = (vector: VectorObject): VectorObject => {
    const normalized = normalizeVectorValue(vector.value);
    if (
        normalized[0] === vector.value[0] &&
        normalized[1] === vector.value[1]
    ) {
        return vector;
    }
    return { ...vector, value: normalized };
};

const PATH_RESOLUTION = 100; // Number of steps per unit of t
const CONTACT_TOLERANCE = 0.07;
type TransformationsMap = Record<number, { initial: Point2; final: Point2 | null; fullPath: Point2[] }>;
interface WallContact {
    wallId: number;
    axis: Wall['axis'];
    position: number;
    point: Point2;
    normalDirection: 1 | -1;
}

type Eigenvalue = { re: number; im: number };
type TrailSample = { position: Point2; timestamp: number; index: number };

interface BackendVisualization {
    backend: MatrixBackend;
    label: string;
    color: string;
    transformations: TransformationsMap;
}

const sanitizeNumber = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeMatrix2 = (input: unknown, fallback: Matrix2 = INITIAL_MATRIX): Matrix2 => {
    if (!Array.isArray(input)) return fallback;
    const rows: Vector2[] = [];
    for (let i = 0; i < 2; i++) {
        const row = Array.isArray(input[i]) ? input[i] as unknown[] : [];
        rows.push([
            sanitizeNumber(row[0], fallback[i]?.[0] ?? 0),
            sanitizeNumber(row[1], fallback[i]?.[1] ?? 0)
        ] as Vector2);
    }
    return rows as Matrix2;
};

const sanitizeVectors = (input: unknown, fallback: VectorObject[] = INITIAL_VECTORS): VectorObject[] => {
    if (!Array.isArray(input)) return fallback;
    const result: VectorObject[] = [];
    let syntheticId = Date.now();
    for (const entry of input) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as Partial<VectorObject>;
        const id = typeof candidate.id === 'number' && Number.isFinite(candidate.id)
            ? candidate.id
            : syntheticId++;
        const valueSource = Array.isArray(candidate.value) ? candidate.value : [];
        const value: Vector2 = [
            sanitizeNumber(valueSource[0], 0),
            sanitizeNumber(valueSource[1], 0)
        ];
        const visible = typeof candidate.visible === 'boolean' ? candidate.visible : true;
        const color = typeof candidate.color === 'string' && candidate.color ? candidate.color : VECTOR_COLORS[id % VECTOR_COLORS.length] ?? '#ffffff';
        result.push({ id, value, visible, color });
    }
    return result.length > 0 ? result : fallback;
};

const sanitizeWalls = (input: unknown): Wall[] => {
    if (!Array.isArray(input)) return [];
    const axes: Wall['axis'][] = ['x', 'y'];
    const walls: Wall[] = [];
    let syntheticId = Date.now();
    for (const entry of input) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as Partial<Wall>;
        const axis = typeof candidate.axis === 'string' && axes.includes(candidate.axis as Wall['axis'])
            ? candidate.axis as Wall['axis']
            : null;
        if (!axis) continue;
        const position = sanitizeNumber(candidate.position, 0);
        const id = typeof candidate.id === 'number' && Number.isFinite(candidate.id)
            ? candidate.id
            : syntheticId++;
        walls.push({ id, axis, position });
    }
    return walls;
};

const sanitizeFadingStyle = (value: unknown): FadingPathStyle => {
    return value === 'dots' ? 'dots' : 'smooth';
};

const sanitizeAnimationConfig = (input: unknown): { duration: number; startT: number; endT: number; easing: keyof typeof easingFunctions } => {
    const base = {
        duration: 5,
        startT: 0,
        endT: 2,
        easing: 'easeInOutSine' as keyof typeof easingFunctions
    };
    if (!input || typeof input !== 'object') {
        return base;
    }
    const candidate = input as Partial<{ duration: number; startT: number; endT: number; easing: string }>;
    const duration = Math.max(0.1, sanitizeNumber(candidate.duration, base.duration));
    const startT = sanitizeNumber(candidate.startT, base.startT);
    const endT = sanitizeNumber(candidate.endT, base.endT);
    const easing = typeof candidate.easing === 'string' && candidate.easing in easingFunctions
        ? candidate.easing as keyof typeof easingFunctions
        : base.easing;
    const safeStart = Number.isFinite(startT) ? startT : base.startT;
    const safeEnd = Number.isFinite(endT) ? Math.max(endT, safeStart) : Math.max(base.endT, safeStart);
    return { duration, startT: safeStart, endT: safeEnd, easing };
};

const sanitizeActivation = (input: unknown): { name: string; customFnStr: string } => {
    if (!input || typeof input !== 'object') {
        return { name: 'identity', customFnStr: 'x' };
    }
    const candidate = input as Partial<{ name: string; customFnStr: string }>;
    const name = typeof candidate.name === 'string' && candidate.name.length > 0 ? candidate.name : 'identity';
    const customFnStr = typeof candidate.customFnStr === 'string' ? candidate.customFnStr : 'x';
    return { name, customFnStr };
};

const sanitizeProfileData = (data: ProfileData | null): ProfileData | null => {
    if (!data) return null;
    const animationConfig = sanitizeAnimationConfig(data.animationConfig);
    const activationConfig = sanitizeActivation(data.activation);
    const ensureBoolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
    const preciseT = sanitizeNumber(data.tPrecision, 0.01);
    const safeT = sanitizeNumber(data.t, animationConfig.startT);
    const clampedT = clamp(safeT, animationConfig.startT, animationConfig.endT);
    const sanitizeBackend = (value: unknown): MatrixBackend => (value === 'exp-log' ? 'exp-log' : 'kan');

    return {
        version: data.version ?? 1,
        matrixA: sanitizeMatrix2(data.matrixA),
        vectors: sanitizeVectors(data.vectors),
        walls: sanitizeWalls(data.walls),
        t: clampedT,
        tPrecision: preciseT > 0 ? preciseT : 0.01,
        dotMode: ensureBoolean(data.dotMode, false),
        fadingPath: ensureBoolean(data.fadingPath, false),
        fadingPathLength: Math.max(2, Math.round(sanitizeNumber(data.fadingPathLength, 120))),
        fadingPathStyle: sanitizeFadingStyle(data.fadingPathStyle),
        showStartMarkers: ensureBoolean(data.showStartMarkers, true),
        showEndMarkers: ensureBoolean(data.showEndMarkers, true),
        dynamicFadingPath: ensureBoolean(data.dynamicFadingPath, false),
        animationConfig,
        repeatAnimation: ensureBoolean(data.repeatAnimation, false),
        activation: activationConfig,
        selectedPresetName: typeof data.selectedPresetName === 'string' ? data.selectedPresetName : PRESET_MATRICES[0].name,
        matrixScalar: sanitizeNumber(data.matrixScalar, 1),
        matrixExponent: Math.max(1, Math.round(sanitizeNumber(data.matrixExponent, 1))),
        normalizeMatrix: ensureBoolean(data.normalizeMatrix, false),
        linearEigenInterpolation: ensureBoolean(data.linearEigenInterpolation, false),
        dotSize: clamp(sanitizeNumber(data.dotSize, DOT_SIZE_DEFAULT), DOT_SIZE_MIN, DOT_SIZE_MAX),
        autoNormalizeVectors: ensureBoolean(data.autoNormalizeVectors, false),
        exploreRandomizeVectors: ensureBoolean(data.exploreRandomizeVectors, true),
        matrixBackend: sanitizeBackend(data.matrixBackend),
        compareBackends: ensureBoolean(data.compareBackends, false)
    };
};
const mapEigenvalues = (
    raw: (number | math.Complex)[] | math.Matrix | null | undefined
): Eigenvalue[] | null => {
    if (!raw) return null;
    const valuesArray = Array.isArray(raw)
        ? raw
        : typeof (raw as math.Matrix)?.toArray === 'function'
            ? ((raw as math.Matrix).toArray() as (number | math.Complex)[])
            : null;
    if (!valuesArray) return null;

    return valuesArray.map(value => {
        if (typeof value === 'number') {
            return { re: value, im: 0 };
        }
        if (typeof value === 'object' && value !== null && 're' in value && 'im' in value) {
            const complex = value as math.Complex;
            return {
                re: Number.isFinite(complex.re) ? complex.re : NaN,
                im: Number.isFinite(complex.im) ? complex.im : NaN
            };
        }
        const parsed = Number(value);
        return { re: Number.isFinite(parsed) ? parsed : NaN, im: NaN };
    });
};

// --- COMPONENT ---

function App() {
    // Core state
    const [matrixA, setMatrixA] = useState<Matrix2>(INITIAL_MATRIX);
    const [vectors, setVectors] = useState<VectorObject[]>(INITIAL_VECTORS);
    const [autoNormalizeVectors, setAutoNormalizeVectors] = useState<boolean>(false);
    const [walls, setWalls] = useState<Wall[]>([]);
    const [t, setT] = useState<number>(0);
    const [tPrecision, setTPrecision] = useState<number>(0.01);
    const [error, setError] = useState<string | null>(null);
    const [backendError, setBackendError] = useState<string | null>(null);
    const [dotMode, setDotMode] = useState<boolean>(false);
    const [dotSize, setDotSize] = useState<number>(DOT_SIZE_DEFAULT);
    const [fadingPath, setFadingPath] = useState<boolean>(false);
    const [fadingPathLength, setFadingPathLength] = useState<number>(120);
    const [fadingPathStyle, setFadingPathStyle] = useState<FadingPathStyle>('smooth');
    const [showStartMarkers, setShowStartMarkers] = useState<boolean>(true);
    const [showEndMarkers, setShowEndMarkers] = useState<boolean>(true);
    const [dynamicFadingPath, setDynamicFadingPath] = useState<boolean>(false);
    const [exploreRandomizeVectors, setExploreRandomizeVectors] = useState<boolean>(true);
    const [matrixBackend, setMatrixBackend] = useState<MatrixBackend>('kan');
    const [compareBackends, setCompareBackends] = useState<boolean>(false);
    const [selectedPresetName, setSelectedPresetName] = useState(PRESET_MATRICES[0].name);
    const [matrixScalar, setMatrixScalar] = useState<number>(1);
    const [matrixExponent, setMatrixExponent] = useState<number>(1);
    const [navigationSensitivity, setNavigationSensitivity] = useState<number>(0.75);
    const [normalizeMatrix, setNormalizeMatrix] = useState<boolean>(false);
    const [normalizationWarning, setNormalizationWarning] = useState<string | null>(null);
    const [linearEigenInterpolation, setLinearEigenInterpolation] = useState<boolean>(false);
    const [profileSummaries, setProfileSummaries] = useState<ProfileSummary[]>([]);
    const [activeProfileName, setActiveProfileName] = useState<string | null>(null);
    const [controlsPanelVisible, setControlsPanelVisible] = useState<boolean>(true);
    const [infoPanelVisible, setInfoPanelVisible] = useState<boolean>(true);
    const [controlsActiveTab, setControlsActiveTab] = useState<ControlsPanelTab>('controls');
    const [preTourTab, setPreTourTab] = useState<ControlsPanelTab>('controls');
    const [tourActive, setTourActive] = useState<boolean>(false);
    const [tourStepIndex, setTourStepIndex] = useState<number>(0);

    // Animation state
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isExploring, setIsExploring] = useState<boolean>(false);
    const [repeatAnimation, setRepeatAnimation] = useState<boolean>(false);
    const [animationConfig, setAnimationConfig] = useState({
        duration: 5, // in seconds
        startT: 0,
        endT: 2,
        easing: 'easeInOutSine' as keyof typeof easingFunctions
    });
    const animationFrameRef = useRef<number | null>(null);
    const animationStartRef = useRef<number | null>(null);
    const animationDirectionRef = useRef<1 | -1>(1);
    const previousTRef = useRef<number>(t);
    const dynamicTrailPointsRef = useRef<Map<string, TrailSample[]>>(new Map());
    const previousSampleIndexRef = useRef<Map<string, number>>(new Map());

    // Activation function state
    const [activation, setActivation] = useState<{
        name: string;
        customFnStr: string;
        currentFn: ActivationFunction;
        error: string | null;
    }>({
        name: 'identity',
        customFnStr: 'x',
        currentFn: activationFunctionMap.identity,
        error: null
    });

    // Effect to parse custom activation function string
    useEffect(() => {
        if (activation.name === 'custom') {
            const { fn, error } = parseCustomActivation(activation.customFnStr);
            setActivation(a => ({ ...a, currentFn: fn || ((x: number) => NaN), error }));
        } else {
            setActivation(a => ({
                ...a,
                currentFn: activationFunctionMap[a.name as keyof typeof activationFunctionMap] || activationFunctionMap.identity,
                error: null
            }));
        }
    }, [activation.name, activation.customFnStr]);

    useEffect(() => {
        if (!tourActive) {
            setPreTourTab(controlsActiveTab);
        }
    }, [controlsActiveTab, tourActive]);


    const stopAnimation = useCallback(() => {
        setIsPlaying(false);
        setIsExploring(false);
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        animationStartRef.current = null;
        animationDirectionRef.current = 1;
    }, []);

    const resetTime = useCallback(() => {
        stopAnimation();
        setT(animationConfig.startT);
    }, [stopAnimation, animationConfig.startT]);

    useEffect(() => {
        if (!fadingPath || !dynamicFadingPath) {
            dynamicTrailPointsRef.current.clear();
            previousSampleIndexRef.current.clear();
        }
    }, [fadingPath, dynamicFadingPath]);

    useEffect(() => {
        if (!tourActive) return;
        const currentStep = TOUR_STEPS[tourStepIndex];
        if (!currentStep) return;
        if (currentStep.tab && currentStep.tab !== 'none' && currentStep.tab !== controlsActiveTab) {
            setControlsActiveTab(currentStep.tab);
        }
        if (!controlsPanelVisible) {
            setControlsPanelVisible(true);
        }
        if (currentStep.id === 'info') {
            setInfoPanelVisible(true);
        }
    }, [tourActive, tourStepIndex, controlsActiveTab, controlsPanelVisible]);

    const randomizeVectors = useCallback((nonNegative = false) => {
        setVectors(prev => prev.map(vector => {
            const randomized = randomVector(nonNegative);
            const value = autoNormalizeVectors ? normalizeVectorValue(randomized) : randomized;
            return {
                ...vector,
                value
            };
        }));
    }, [autoNormalizeVectors]);

    const applyRandomMatrix = useCallback((options?: { randomizeVectors?: boolean; nonNegativeVectors?: boolean }) => {
        const randomMatrix = generateRandomGLPlusMatrix({
            requirePositiveEigenvalues: matrixBackend === 'exp-log' || compareBackends
        });
        setMatrixA(randomMatrix);
        setSelectedPresetName('Custom');
        const shouldRandomizeVectors = options?.randomizeVectors ?? true;
        if (shouldRandomizeVectors) {
            randomizeVectors(options?.nonNegativeVectors ?? false);
        }
    }, [randomizeVectors, matrixBackend, compareBackends]);


    // Animation Loop
    useEffect(() => {
        if (!isPlaying) {
            return;
        }

        const animate = (timestamp: number) => {
            if (!animationStartRef.current) {
                animationStartRef.current = timestamp;
            }

            const elapsed = timestamp - animationStartRef.current;
            const progress = Math.min(elapsed / (animationConfig.duration * 1000), 1);
            
            const easingFunc = easingFunctions[animationConfig.easing] || easingFunctions.linear;
            const easedProgress = easingFunc(progress);

            const direction = animationDirectionRef.current;
            const cycleStart = direction === 1 ? animationConfig.startT : animationConfig.endT;
            const cycleEnd = direction === 1 ? animationConfig.endT : animationConfig.startT;

            setT(cycleStart + easedProgress * (cycleEnd - cycleStart));

            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(animate);
            } else {
                setT(cycleEnd);
                const shouldRepeat = repeatAnimation || isExploring;
                if (shouldRepeat) {
                    if (isExploring && direction === -1) {
                        applyRandomMatrix({
                            randomizeVectors: exploreRandomizeVectors,
                            nonNegativeVectors: true
                        });
                        setT(animationConfig.startT);
                    }
                    animationDirectionRef.current = direction === 1 ? -1 : 1;
                    animationStartRef.current = null;
                    animationFrameRef.current = requestAnimationFrame(animate);
                } else {
                    stopAnimation();
                }
            }
        };

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isPlaying, animationConfig, repeatAnimation, stopAnimation, isExploring, applyRandomMatrix, exploreRandomizeVectors]);


    // --- Handlers ---
    const handleMatrixChange = useCallback((newMatrix: Matrix2) => {
        setMatrixA(newMatrix);
        setSelectedPresetName('Custom');
    }, []);

    const handlePresetSelect = useCallback((name: string) => {
        const preset = PRESET_MATRICES.find(p => p.name === name);
        if (preset) {
            setSelectedPresetName(name);
            setMatrixA(preset.matrix);
        }
    }, []);

    const handleAddVector = useCallback(() => {
        setVectors(prev => {
            if (prev.length >= VECTOR_COLORS.length) return prev;
            const randomized = randomVector();
            const newVector: VectorObject = {
                id: Date.now(),
                value: autoNormalizeVectors ? normalizeVectorValue(randomized) : randomized,
                visible: true,
                color: VECTOR_COLORS[prev.length % VECTOR_COLORS.length]
            };
            return [...prev, newVector];
        });
    }, [autoNormalizeVectors]);

    const handleRemoveVector = useCallback((id: number) => {
        setVectors(prev => prev.filter(v => v.id !== id));
    }, []);

    const handleVectorChange = useCallback((id: number, newValue: Vector2) => {
        setVectors(prev => prev.map(v => {
            if (v.id !== id) return v;
            const value = autoNormalizeVectors ? normalizeVectorValue(newValue) : newValue;
            return { ...v, value };
        }));
    }, [autoNormalizeVectors]);
    
    const handleVectorColorChange = useCallback((id: number, newColor: string) => {
        setVectors(prev => prev.map(v => v.id === id ? { ...v, color: newColor } : v));
    }, []);

    const handleToggleVectorVisibility = useCallback((id: number) => {
        setVectors(prev => prev.map(v => v.id === id ? { ...v, visible: !v.visible } : v));
    }, []);

    const handleNormalizeVectors = useCallback(() => {
        setVectors(prev => prev.map(normalizeVectorObject));
    }, []);

    const handleAutoNormalizeToggle = useCallback((enabled: boolean) => {
        setAutoNormalizeVectors(enabled);
        if (enabled) {
            setVectors(prev => prev.map(normalizeVectorObject));
        }
    }, []);

    const handleAddWall = useCallback(() => {
        const newWall: Wall = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            axis: 'x',
            position: 0
        };
        setWalls(prev => [...prev, newWall]);
    }, []);

    const handleUpdateWall = useCallback((id: number, updates: Partial<Wall>) => {
        setWalls(prev => prev.map(wall => {
            if (wall.id !== id) return wall;
            const nextPosition = updates.position !== undefined ? (Number.isFinite(updates.position) ? updates.position : wall.position) : wall.position;
            const nextAxis = updates.axis ?? wall.axis;
            return { ...wall, axis: nextAxis, position: nextPosition };
        }));
    }, []);

    const handleRemoveWall = useCallback((id: number) => {
        setWalls(prev => prev.filter(wall => wall.id !== id));
    }, []);

    const handleControlsTabChange = useCallback((tab: ControlsPanelTab) => {
        setControlsActiveTab(tab);
    }, []);

    const startTour = useCallback(() => {
        setPreTourTab(controlsActiveTab);
        setControlsPanelVisible(true);
        setInfoPanelVisible(true);
        setTourStepIndex(0);
        const firstTab = TOUR_STEPS[0]?.tab;
        if (firstTab && firstTab !== 'none') {
            setControlsActiveTab(firstTab);
        }
        setTourActive(true);
    }, [controlsActiveTab]);

    const handleTourExit = useCallback(() => {
        setTourActive(false);
        setTourStepIndex(0);
        setControlsActiveTab(preTourTab);
    }, [preTourTab]);

    const handleTourNext = useCallback(() => {
        setTourStepIndex(prev => Math.min(prev + 1, TOUR_STEPS.length - 1));
    }, []);

    const handleTourPrev = useCallback(() => {
        setTourStepIndex(prev => Math.max(0, prev - 1));
    }, []);

    const handlePlayPause = useCallback(() => {
        if (isPlaying) {
            stopAnimation();
        } else {
             if (t >= animationConfig.endT) {
                setT(animationConfig.startT); 
                animationDirectionRef.current = 1;
             }
             setIsPlaying(true);
        }
    }, [isPlaying, t, animationConfig.startT, animationConfig.endT, stopAnimation]);

    const startExploration = useCallback(() => {
        stopAnimation();
        applyRandomMatrix({
            randomizeVectors: exploreRandomizeVectors,
            nonNegativeVectors: true
        });
        setT(animationConfig.startT);
        animationDirectionRef.current = 1;
        animationStartRef.current = null;
        setIsExploring(true);
        setIsPlaying(true);
    }, [stopAnimation, applyRandomMatrix, animationConfig.startT, exploreRandomizeVectors]);

    const handleExploreToggle = useCallback(() => {
        if (isExploring) {
            stopAnimation();
        } else {
            startExploration();
        }
    }, [isExploring, startExploration, stopAnimation]);

    const handleTChange = useCallback((newT: number) => {
        stopAnimation();
        setT(newT);
    },[stopAnimation]);

    const handleMatrixScalarChange = useCallback((value: number) => {
        const safeValue = Number.isFinite(value) ? value : 1;
        setMatrixScalar(safeValue);
    }, []);

    const handleMatrixExponentChange = useCallback((value: number) => {
        const baseValue = Number.isFinite(value) ? value : 1;
        const sanitized = Math.max(1, Math.round(baseValue));
        setMatrixExponent(sanitized);
    }, []);

    const handleDotSizeChange = useCallback((value: number) => {
        const baseValue = Number.isFinite(value) ? value : DOT_SIZE_DEFAULT;
        const clamped = clamp(baseValue, DOT_SIZE_MIN, DOT_SIZE_MAX);
        setDotSize(clamped);
    }, []);

    const handleNormalizeToggle = useCallback((enabled: boolean) => {
        setNormalizeMatrix(enabled);
        if (!enabled) {
            setNormalizationWarning(null);
        }
    }, []);

    const handleLinearInterpolationToggle = useCallback((enabled: boolean) => {
        setLinearEigenInterpolation(enabled);
    }, []);

    const handleRepeatToggle = useCallback((enabled: boolean) => {
        setRepeatAnimation(enabled);
        if (!enabled) {
            animationDirectionRef.current = 1;
        }
    }, []);

    const handleFadingPathLengthChange = useCallback((length: number) => {
        const safeLength = Number.isFinite(length) ? Math.max(2, Math.min(600, Math.round(length))) : 120;
        setFadingPathLength(safeLength);
    }, []);

    const profileSnapshot = useMemo<ProfileData>(() => {
        const clonedMatrix = matrixA.map(row => [...row] as Vector2) as Matrix2;
        const clonedVectors = vectors.map(vector => ({
            ...vector,
            value: [...vector.value] as Vector2
        }));
        const clonedWalls = walls.map(wall => ({ ...wall }));
        return {
            version: getProfileVersion(),
            matrixA: clonedMatrix,
            vectors: clonedVectors,
            walls: clonedWalls,
            t,
            tPrecision,
            dotMode,
            fadingPath,
            fadingPathLength,
            fadingPathStyle,
            showStartMarkers,
            showEndMarkers,
            dynamicFadingPath,
            exploreRandomizeVectors,
            animationConfig: {
                duration: animationConfig.duration,
                startT: animationConfig.startT,
                endT: animationConfig.endT,
                easing: animationConfig.easing
            },
            repeatAnimation,
            activation: {
                name: activation.name,
                customFnStr: activation.customFnStr
            },
            selectedPresetName,
            matrixScalar,
            matrixExponent,
            normalizeMatrix,
            linearEigenInterpolation,
            dotSize,
            autoNormalizeVectors,
            navigationSensitivity,
            matrixBackend,
            compareBackends
        };
    }, [
        matrixA,
        vectors,
        walls,
        t,
        tPrecision,
        dotMode,
        fadingPath,
        fadingPathLength,
        fadingPathStyle,
        showStartMarkers,
        showEndMarkers,
        dynamicFadingPath,
        exploreRandomizeVectors,
        animationConfig.duration,
        animationConfig.startT,
        animationConfig.endT,
        animationConfig.easing,
        repeatAnimation,
        activation.name,
        activation.customFnStr,
        selectedPresetName,
        matrixScalar,
        matrixExponent,
        normalizeMatrix,
        linearEigenInterpolation,
        dotSize,
        autoNormalizeVectors,
        navigationSensitivity,
        matrixBackend,
        compareBackends
    ]);

    const applyProfileData = useCallback((rawData: ProfileData | null) => {
        const data = sanitizeProfileData(rawData);
        if (!data) {
            return;
        }
        stopAnimation();
        setMatrixA(data.matrixA);
        setVectors(data.autoNormalizeVectors ? data.vectors.map(normalizeVectorObject) : data.vectors);
        setWalls(data.walls);
        handleMatrixScalarChange(data.matrixScalar);
        handleMatrixExponentChange(data.matrixExponent);
        setNormalizeMatrix(data.normalizeMatrix);
        setLinearEigenInterpolation(data.linearEigenInterpolation);
        setAutoNormalizeVectors(data.autoNormalizeVectors);
        setDotMode(data.dotMode);
        setDotSize(data.dotSize);
        setFadingPath(data.fadingPath);
        handleFadingPathLengthChange(data.fadingPathLength);
        setFadingPathStyle(data.fadingPathStyle);
        setShowStartMarkers(data.showStartMarkers);
        setShowEndMarkers(data.showEndMarkers);
        setDynamicFadingPath(data.dynamicFadingPath);
        setExploreRandomizeVectors(data.exploreRandomizeVectors);
        setMatrixBackend(data.matrixBackend);
        setCompareBackends(Boolean(data.compareBackends));
        setNavigationSensitivity(data.navigationSensitivity ?? 0.75);
        setAnimationConfig({
            duration: data.animationConfig.duration,
            startT: data.animationConfig.startT,
            endT: data.animationConfig.endT,
            easing: data.animationConfig.easing
        });
        setRepeatAnimation(data.repeatAnimation);
        setActivation(prev => ({
            ...prev,
            name: data.activation.name,
            customFnStr: data.activation.customFnStr
        }));
        setSelectedPresetName(data.selectedPresetName);
        setTPrecision(data.tPrecision);
        setT(data.t);
        setError(null);
    }, [
        stopAnimation,
        handleMatrixScalarChange,
        handleMatrixExponentChange,
        handleFadingPathLengthChange
    ]);

    const refreshProfileSummaries = useCallback(() => {
        setProfileSummaries(listProfiles());
    }, []);

    useEffect(() => {
        refreshProfileSummaries();
        const lastUsed = loadLastUsedProfile();
        if (lastUsed) {
            const stored = loadStoredProfile(lastUsed);
            if (stored) {
                applyProfileData(stored);
                setActiveProfileName(lastUsed);
                return;
            }
        }
        const lastSession = loadLastSession();
        if (lastSession) {
            applyProfileData(lastSession);
            setActiveProfileName(null);
        }
    }, [applyProfileData, refreshProfileSummaries]);

    useEffect(() => {
        saveLastSession(profileSnapshot);
    }, [profileSnapshot]);

    useEffect(() => {
        saveLastUsedProfile(activeProfileName);
    }, [activeProfileName]);

    const handleProfileSave = useCallback((name: string): ProfileOperationResult => {
        const trimmed = name.trim();
        if (!trimmed) {
            return { success: false, status: 'error', message: 'Profile name cannot be empty.' };
        }
        try {
            const result = persistProfile(trimmed, profileSnapshot);
            refreshProfileSummaries();
            setActiveProfileName(trimmed);
            return result === 'created'
                ? { success: true, status: 'success', message: `Saved profile "${trimmed}".` }
                : { success: true, status: 'info', message: `Updated profile "${trimmed}".` };
        } catch (error) {
            console.error('Profile save failed:', error);
            return { success: false, status: 'error', message: 'Failed to save profile.' };
        }
    }, [profileSnapshot, refreshProfileSummaries]);

    const handleProfileLoad = useCallback((name: string): ProfileOperationResult => {
        const trimmed = name.trim();
        if (!trimmed) {
            return { success: false, status: 'error', message: 'Select a profile to load.' };
        }
        const stored = loadStoredProfile(trimmed);
        if (!stored) {
            return { success: false, status: 'error', message: 'Profile not found.' };
        }
        applyProfileData(stored);
        refreshProfileSummaries();
        setActiveProfileName(trimmed);
        return { success: true, status: 'success', message: `Loaded profile "${trimmed}".` };
    }, [applyProfileData, refreshProfileSummaries]);

    const handleProfileDelete = useCallback((name: string): ProfileOperationResult => {
        const trimmed = name.trim();
        if (!trimmed) {
            return { success: false, status: 'error', message: 'Select a profile to delete.' };
        }
        const removed = removeStoredProfile(trimmed);
        if (!removed) {
            return { success: false, status: 'error', message: 'Profile not found.' };
        }
        refreshProfileSummaries();
        if (activeProfileName === trimmed) {
            setActiveProfileName(null);
        }
        return { success: true, status: 'info', message: `Deleted profile "${trimmed}".` };
    }, [refreshProfileSummaries, activeProfileName]);

    // --- Derived Matrix Configuration ---

    const matrixPreparation = useMemo(() => {
        const toNumber = (val: unknown): number => {
            if (typeof val === 'number') return val;
            if (typeof val === 'object' && val !== null && 're' in (val as any)) {
                return Number((val as { re: number }).re);
            }
            const parsed = Number(val);
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const toMatrix2Local = (input: number[][]): Matrix2 => {
            return input.map(row => [toNumber(row[0]), toNumber(row[1])] as Vector2) as Matrix2;
        };

        const safeScalar = Number.isFinite(matrixScalar) ? matrixScalar : 1;
        const safeExponent = Math.max(1, Math.round(Number.isFinite(matrixExponent) ? matrixExponent : 1));

        try {
            const baseMatrix = math.matrix(matrixA);
            const scaledMatrix = math.multiply(baseMatrix, safeScalar) as math.Matrix;
            const poweredMatrix = safeExponent === 1 ? scaledMatrix : (math.pow(scaledMatrix, safeExponent) as math.Matrix);
            const poweredArray = poweredMatrix.toArray() as number[][];
            const adjustedMatrix = toMatrix2Local(poweredArray);

            const determinantBefore = Number(math.det(poweredMatrix));
            let normalizationApplied = false;
            let normalizationFailed = false;
            let determinantAfter: number | null = null;
            let effectiveMatrix = adjustedMatrix;

            if (normalizeMatrix) {
                if (Math.abs(determinantBefore) < 1e-8) {
                    normalizationFailed = true;
                } else {
                    const detRoot = Math.sqrt(Math.abs(determinantBefore));
                    const normalizedMatrix = math.divide(poweredMatrix, detRoot) as math.Matrix;
                    const normalizedArray = normalizedMatrix.toArray() as number[][];
                    effectiveMatrix = toMatrix2Local(normalizedArray);
                    normalizationApplied = true;
                    determinantAfter = Number(math.det(normalizedMatrix));
                }
            }

            return {
                matrix: effectiveMatrix,
                adjustedMatrix,
                scalar: safeScalar,
                exponent: safeExponent,
                normalizationApplied,
                normalizationFailed,
                determinantBefore,
                determinantAfter,
                error: null as string | null,
            };
        } catch (err) {
            console.error('Matrix adjustment error:', err);
            return {
                matrix: null,
                adjustedMatrix: matrixA,
                scalar: safeScalar,
                exponent: safeExponent,
                normalizationApplied: false,
                normalizationFailed: false,
                determinantBefore: null,
                determinantAfter: null,
                error: 'Matrix adjustment error. Check scalar or exponent values.'
            };
        }
    }, [matrixA, matrixScalar, matrixExponent, normalizeMatrix]);

    useEffect(() => {
        if (normalizeMatrix && matrixPreparation.normalizationFailed) {
            setNormalizationWarning('Normalization requires a non-zero determinant. Matrix left unnormalized.');
            setNormalizeMatrix(false);
        } else if (normalizeMatrix && matrixPreparation.normalizationApplied) {
            setNormalizationWarning(null);
        }
    }, [normalizeMatrix, matrixPreparation.normalizationFailed, matrixPreparation.normalizationApplied]);

    useEffect(() => {
        setNormalizationWarning(null);
    }, [matrixA, matrixScalar, matrixExponent]);

    useEffect(() => {
        setBackendError(null);
    }, [matrixPreparation.matrix]);

    const expLogCompatibility = useMemo<ExpLogValidationResult>(() => {
        if (!matrixPreparation.matrix) {
            return { valid: false, reason: 'Provide a valid matrix to evaluate exp(t ln A).' };
        }
        return validateExpLogMatrix(matrixPreparation.matrix);
    }, [matrixPreparation.matrix]);

    const handleMatrixBackendChange = useCallback((backend: MatrixBackend) => {
        if (backend === 'exp-log') {
            if (!expLogCompatibility.valid) {
                setBackendError(expLogCompatibility.reason ?? 'exp(t ln A) requires strictly positive real eigenvalues or complex conjugate pairs.');
                return;
            }
        }
        setBackendError(null);
        setMatrixBackend(backend);
    }, [expLogCompatibility]);

    const handleCompareBackendsToggle = useCallback((enabled: boolean) => {
        if (enabled && !expLogCompatibility.valid) {
            setBackendError(expLogCompatibility.reason ?? 'exp(t ln A) requires strictly positive real eigenvalues or complex conjugate pairs.');
            return;
        }
        setBackendError(null);
        setCompareBackends(enabled);
    }, [expLogCompatibility]);

    const kanEvaluator = useMemo(() => {
        if (!matrixPreparation.matrix) return null;
        return createMatrixEvaluator(matrixPreparation.matrix, 'kan');
    }, [matrixPreparation.matrix]);

    const expLogEvaluatorInstance = useMemo(() => {
        if (!matrixPreparation.matrix || !expLogCompatibility.valid) return null;
        return createMatrixEvaluator(matrixPreparation.matrix, 'exp-log');
    }, [matrixPreparation.matrix, expLogCompatibility.valid]);

    const matrixEvaluator = useMemo(() => {
        if (matrixBackend === 'exp-log') {
            return expLogEvaluatorInstance;
        }
        return kanEvaluator;
    }, [matrixBackend, kanEvaluator, expLogEvaluatorInstance]);

    const samplingConfig = useMemo(() => {
        const range = animationConfig.endT - animationConfig.startT;
        const safePrecision = Number.isFinite(tPrecision) && tPrecision > 0 ? tPrecision : 0.01;
        const baseStep = 1 / PATH_RESOLUTION;
        const effectiveStep = Math.min(safePrecision, baseStep);

        if (range <= 0) {
            return { times: [] as number[], range, totalSteps: 0 };
        }

        const totalSteps = Math.max(1, Math.ceil(range / effectiveStep));
        const times: number[] = new Array(totalSteps + 1);
        for (let i = 0; i <= totalSteps; i++) {
            times[i] = animationConfig.startT + (i / totalSteps) * range;
        }

        return { times, range, totalSteps };
    }, [animationConfig.startT, animationConfig.endT, tPrecision]);

    // --- Memoized Calculations ---

    const vectorTransformationsResult = useMemo(() => {
        const baseError = matrixPreparation.error
            ?? (activation.error ? `Activation Function Error: ${activation.error}` : null);

        if (baseError) {
            return { visualizations: [] as BackendVisualization[], error: baseError };
        }

        const range = samplingConfig.range;
        if (range <= 0) {
            return { visualizations: [] as BackendVisualization[], error: "Animation End Time must be greater than Start Time." };
        }

        const times = samplingConfig.times;
        if (times.length === 0) {
            return { visualizations: [] as BackendVisualization[], error: 'No sampling points available.' };
        }

        const evaluateBackends: MatrixBackend[] = compareBackends ? ['kan', 'exp-log'] : [matrixBackend];

        const evaluatorForBackend = (backendKey: MatrixBackend) =>
            backendKey === 'kan' ? kanEvaluator : expLogEvaluatorInstance;

        const activationFn = activation.currentFn;
        const visualizations: BackendVisualization[] = [];
        let firstError: string | null = null;

        for (const backendKey of evaluateBackends) {
            const evaluator = evaluatorForBackend(backendKey);
            if (!evaluator) {
                if (backendKey === 'exp-log') {
                    firstError = firstError ?? (expLogCompatibility.reason ?? 'exp(t ln A) backend unavailable.');
                } else {
                    firstError = firstError ?? 'Matrix unavailable.';
                }
                continue;
            }

            const samples = times.map(time => evaluator.getMatrixAt(time, { linearEigenInterpolation }));
            if (samples.some(sample => !sample)) {
                firstError = firstError ?? 'Matrix generation failed at specific time samples.';
                continue;
            }

            const transformations: TransformationsMap = {};
            let calculationError = false;

            for (const vector of vectors) {
                const fullPath: Point2[] = [];

                for (const sample of samples) {
                    if (!sample) {
                        calculationError = true;
                        break;
                    }
                    const rawPoint = multiplyMatrixVector(sample, vector.value);
                    const activatedPoint = rawPoint.map(activationFn) as Vector2;
                    fullPath.push({ x: activatedPoint[0], y: activatedPoint[1] });
                }
                if (calculationError || fullPath.length === 0) {
                    calculationError = true;
                    break;
                }

                const initial = fullPath[0] ?? { x: activationFn(vector.value[0]), y: activationFn(vector.value[1]) };
                const final = fullPath[fullPath.length - 1] ?? initial;

                transformations[vector.id] = { initial, final, fullPath };
            }

            if (calculationError) {
                firstError = firstError ?? "Calculation Error: The matrix might be singular or non-diagonalizable.";
                continue;
            }

            visualizations.push({
                backend: backendKey,
                label: BACKEND_LABELS[backendKey],
                color: BACKEND_COLORS[backendKey],
                transformations
            });
        }

        return {
            visualizations,
            error: visualizations.length === 0 ? (firstError ?? 'Matrix unavailable.') : firstError
        };
    }, [
        matrixPreparation,
        vectors,
        activation.currentFn,
        activation.error,
        kanEvaluator,
        expLogEvaluatorInstance,
        samplingConfig,
        matrixBackend,
        compareBackends,
        expLogCompatibility,
        linearEigenInterpolation
    ]);


    const activeVisualizations = vectorTransformationsResult.visualizations;

    const sceneData = useMemo(() => {
        const visualizations = activeVisualizations;
        if (visualizations.length === 0) return [];
        const range = animationConfig.endT - animationConfig.startT;
        if (range <= 0) return [];

        previousTRef.current = t;

        const resolveNormalDirection = (primary: number, secondary?: number): 1 | -1 => {
            if (Math.abs(primary) > 1e-6) {
                return primary >= 0 ? 1 : -1;
            }
            if (secondary !== undefined && Math.abs(secondary) > 1e-6) {
                return secondary >= 0 ? 1 : -1;
            }
            return 1;
        };

        const computeContact = (wall: Wall, current: Point2, previous: Point2 | null): WallContact | null => {
            const currentValue = wall.axis === 'x' ? current.x : current.y;
            const diffCurrent = currentValue - wall.position;

            if (Math.abs(diffCurrent) <= CONTACT_TOLERANCE) {
                const contactPoint: Point2 = wall.axis === 'x'
                    ? { x: wall.position, y: current.y }
                    : { x: current.x, y: wall.position };
                const normalDirection = resolveNormalDirection(diffCurrent, previous ? (wall.axis === 'x' ? previous.x : previous.y) - wall.position : undefined);
                return { wallId: wall.id, axis: wall.axis, position: wall.position, point: contactPoint, normalDirection };
            }

            if (previous) {
                const prevValue = wall.axis === 'x' ? previous.x : previous.y;
                const diffPrev = prevValue - wall.position;

                if (Math.abs(diffPrev) <= CONTACT_TOLERANCE) {
                    const contactPoint: Point2 = wall.axis === 'x'
                        ? { x: wall.position, y: previous.y }
                        : { x: previous.x, y: wall.position };
                    const normalDirection = resolveNormalDirection(diffPrev, diffCurrent);
                    return { wallId: wall.id, axis: wall.axis, position: wall.position, point: contactPoint, normalDirection };
                }

                if (diffPrev * diffCurrent < 0) {
                    const denominator = currentValue - prevValue;
                    if (Math.abs(denominator) > 1e-8) {
                        const ratio = (wall.position - prevValue) / denominator;
                        const clampedRatio = clamp(ratio, 0, 1);
                        const interpolated = {
                            x: lerp(previous.x, current.x, clampedRatio),
                            y: lerp(previous.y, current.y, clampedRatio)
                        };
                        const contactPoint: Point2 = wall.axis === 'x'
                            ? { x: wall.position, y: interpolated.y }
                            : { x: interpolated.x, y: wall.position };
                        const normalDirection = resolveNormalDirection(diffCurrent, diffPrev);
                        return { wallId: wall.id, axis: wall.axis, position: wall.position, point: contactPoint, normalDirection };
                    }
                }
            }

            return null;
        };

        const visibleVectors = vectors.filter(v => v.visible);
        if (dynamicFadingPath && fadingPath) {
            const visibleKeys = new Set<string>();
            visualizations.forEach(viz => {
                visibleVectors.forEach(vector => visibleKeys.add(`${viz.backend}-${vector.id}`));
            });
            dynamicTrailPointsRef.current.forEach((_, key) => {
                if (!visibleKeys.has(key)) {
                    dynamicTrailPointsRef.current.delete(key);
                    previousSampleIndexRef.current.delete(key);
                }
            });
        }

        const entries: SceneVectorEntry[] = [];

        visualizations.forEach(viz => {
            visibleVectors.forEach(vector => {
                const transform = viz.transformations[vector.id];
                if (!transform) {
                    return;
                }
                const progress = (t - animationConfig.startT) / range;
                const sliceEnd = Math.floor(progress * (transform.fullPath.length - 1));
                const clampedIndex = clamp(sliceEnd, 0, transform.fullPath.length - 1);
                const maxTrail = Math.min(fadingPathLength, transform.fullPath.length);
                const cacheKey = `${viz.backend}-${vector.id}`;

                let currentPath: Point2[];
                if (dynamicFadingPath && fadingPath) {
                    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    const maxSamples = Math.max(2, Math.min(maxTrail, Math.round(Math.max(2, fadingPathLength))));
                    const windowMs = lerp(450, 6500, clamp(fadingPathLength / 400, 0, 1));

                    let samples = dynamicTrailPointsRef.current.get(cacheKey) ?? [];
                    let prevIndexStored = previousSampleIndexRef.current.get(cacheKey);

                    const pushSample = (index: number, timestamp: number) => {
                        const point = transform.fullPath[index];
                        if (!point) return;
                        samples.push({ position: { ...point }, timestamp, index });
                    };

                    if (prevIndexStored === undefined || prevIndexStored < 0 || prevIndexStored >= transform.fullPath.length) {
                        samples = [];
                        prevIndexStored = clampedIndex;
                    }

                    const lastSample = samples[samples.length - 1];
                    const step = prevIndexStored < clampedIndex ? 1 : -1;
                    const forward = step === 1;
                    const missingForward = forward
                        ? prevIndexStored !== undefined && prevIndexStored > clampedIndex
                        : prevIndexStored !== undefined && prevIndexStored < clampedIndex;
                    const shouldReset = missingForward || Math.abs(prevIndexStored - clampedIndex) > maxSamples * 2;

                    if (shouldReset) {
                        samples = [];
                        prevIndexStored = forward ? Math.max(0, clampedIndex - 1) : Math.min(transform.fullPath.length - 1, clampedIndex + 1);
                    }

                    if (prevIndexStored === undefined) {
                        pushSample(clampedIndex, now);
                    } else if (prevIndexStored !== clampedIndex) {
                        const fillStep = prevIndexStored < clampedIndex ? 1 : -1;
                        for (let idx = prevIndexStored + fillStep; idx !== clampedIndex + fillStep; idx += fillStep) {
                            pushSample(idx, now);
                        }
                    } else if (!lastSample || now - lastSample.timestamp > 120) {
                        pushSample(clampedIndex, now);
                    }

                    previousSampleIndexRef.current.set(cacheKey, clampedIndex);

                    samples = samples.filter(sample => now - sample.timestamp <= windowMs);

                    if (samples.length === 0) {
                        pushSample(clampedIndex, now);
                    }

                    if (samples.length > maxSamples) {
                        samples = samples.slice(samples.length - maxSamples);
                    }

                    dynamicTrailPointsRef.current.set(cacheKey, samples);

                    currentPath = samples.map(sample => ({ ...sample.position }));
                } else {
                    previousSampleIndexRef.current.set(cacheKey, clampedIndex);
                    dynamicTrailPointsRef.current.delete(cacheKey);
                    if (fadingPath) {
                        const start = Math.max(0, clampedIndex - maxTrail + 1);
                        currentPath = transform.fullPath.slice(start, clampedIndex + 1);
                    } else {
                        currentPath = transform.fullPath.slice(0, clampedIndex + 1);
                    }
                }

                const interpolatedVector = currentPath[currentPath.length - 1] || transform.initial;
                const previousVector = currentPath.length > 1 ? currentPath[currentPath.length - 2] : transform.initial;

                const contacts: WallContact[] = [];
                walls.forEach(wall => {
                    const contact = computeContact(wall, interpolatedVector, previousVector);
                    if (contact) {
                        contacts.push(contact);
                    }
                });

                const entryColor = compareBackends ? viz.color : vector.color;
                const showMarkers = true;

                entries.push({
                    id: `${viz.backend}-${vector.id}`,
                    color: entryColor,
                    initialVector: transform.initial,
                    finalVector: transform.final,
                    interpolatedVector,
                    path: currentPath,
                    contacts,
                    backend: viz.backend,
                    sourceVectorId: vector.id,
                    showMarkers
                });
            });
        });

        return entries;
    }, [
        activeVisualizations,
        animationConfig.startT,
        animationConfig.endT,
        t,
        vectors,
        walls,
        fadingPath,
        dynamicFadingPath,
        fadingPathLength,
        compareBackends,
        matrixBackend
    ]);

    const wallContactCounts = useMemo(() => {
        const counts: Record<number, number> = {};
        sceneData.forEach(entry => {
            entry.contacts.forEach(contact => {
                counts[contact.wallId] = (counts[contact.wallId] ?? 0) + 1;
            });
        });
        return counts;
    }, [sceneData]);

    const effectiveEigenvalues = useMemo<Eigenvalue[] | null>(() => {
        if (!matrixEvaluator) return null;
        return mapEigenvalues(matrixEvaluator.eigenValues);
    }, [matrixEvaluator]);

    const matrixAt = useMemo(() => {
        if (!matrixEvaluator) return null;
        return matrixEvaluator.getMatrixAt(t, { linearEigenInterpolation });
    }, [matrixEvaluator, t, linearEigenInterpolation]);

    const matrixAtDeterminant = useMemo(() => {
        if (!matrixAt) return null;
        try {
            const detValue = math.det(matrixAt as unknown as number[][]) as unknown;
            if (typeof detValue === 'number') {
                return Number.isFinite(detValue) ? detValue : null;
            }
            if (detValue && typeof detValue === 'object' && 're' in detValue) {
                const real = (detValue as { re: number }).re;
                return Number.isFinite(real) ? real : null;
            }
            return null;
        } catch {
            return null;
        }
    }, [matrixAt]);

    const matrixAtEigenvalues = useMemo<Eigenvalue[] | null>(() => {
        if (!matrixAt) return null;
        try {
            const eigsAtT = math.eigs(math.matrix(matrixAt));
            return mapEigenvalues(eigsAtT.values ?? null);
        } catch (error) {
            console.warn('Eigenvalue evaluation at t failed:', error);
            return null;
        }
    }, [matrixAt]);

    const firstVisibleVector = vectors.find(v => v.visible);
    const firstVisibleSceneData = useMemo(() => {
        if (!firstVisibleVector) return null;
        return sceneData.find(entry =>
            entry.sourceVectorId === firstVisibleVector.id &&
            (!compareBackends || entry.backend === matrixBackend)
        ) ?? sceneData.find(entry => entry.sourceVectorId === firstVisibleVector.id) ?? null;
    }, [firstVisibleVector, sceneData, compareBackends, matrixBackend]);

    const rawTransformedV = useMemo(() => {
        if (!firstVisibleVector || !matrixEvaluator) return null;
        return matrixEvaluator.applyToVector(
            t,
            firstVisibleVector.value,
            { linearEigenInterpolation }
        );
    }, [matrixEvaluator, t, firstVisibleVector, linearEigenInterpolation]);

    useEffect(() => {
        if (backendError) {
            setError(backendError);
        } else if (vectorTransformationsResult.error) {
            setError(vectorTransformationsResult.error);
        } else if (normalizationWarning) {
            setError(normalizationWarning);
        } else {
            setError(null);
        }
    }, [backendError, vectorTransformationsResult.error, normalizationWarning]);


    return (
        <>
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 space-y-1 text-center">
                <button
                    type="button"
                    onClick={startTour}
                    disabled={tourActive}
                    className={`px-4 py-2 rounded-lg shadow-lg border text-sm font-semibold transition-colors ${
                        tourActive
                            ? 'bg-gray-800 border-cyan-500/50 text-cyan-300 cursor-not-allowed'
                            : 'bg-cyan-600 border-cyan-500 text-gray-900 hover:bg-cyan-500'
                    }`}
                >
                    {tourActive ? `Tour running (${tourStepIndex + 1}/${TOUR_STEPS.length})` : 'Start guided tour'}
                </button>
                {tourActive && (
                    <p className="text-[11px] text-gray-300">
                        The guide stays active until you hit Skip Tour in the footer.
                    </p>
                )}
            </div>
            <div className="w-screen h-screen flex flex-col md:flex-row bg-gray-900 overflow-hidden">
                {controlsPanelVisible && (
                    <ControlsPanel
                        activeTab={controlsActiveTab}
                        onTabChange={handleControlsTabChange}
                        matrix={matrixA}
                        vectors={vectors}
                        autoNormalizeVectors={autoNormalizeVectors}
                        walls={walls}
                        t={t}
                        tPrecision={tPrecision}
                        dotMode={dotMode}
                        dotSize={dotSize}
                        fadingPath={fadingPath}
                        fadingPathLength={fadingPathLength}
                        fadingPathStyle={fadingPathStyle}
                        showStartMarkers={showStartMarkers}
                        showEndMarkers={showEndMarkers}
                        dynamicFadingPath={dynamicFadingPath}
                        isPlaying={isPlaying}
                        isExploring={isExploring}
                        exploreRandomizeVectors={exploreRandomizeVectors}
                        animationConfig={animationConfig}
                        repeatAnimation={repeatAnimation}
                        activationConfig={activation}
                        selectedPresetName={selectedPresetName}
                        matrixScalar={matrixScalar}
                        matrixExponent={matrixExponent}
                        normalizeMatrix={normalizeMatrix}
                        linearEigenInterpolation={linearEigenInterpolation}
                        navigationSensitivity={navigationSensitivity}
                        matrixBackend={matrixBackend}
                        compareBackends={compareBackends}
                        normalizationWarning={normalizationWarning}
                        onMatrixChange={handleMatrixChange}
                        onPresetSelect={handlePresetSelect}
                        onMatrixScalarChange={handleMatrixScalarChange}
                        onMatrixExponentChange={handleMatrixExponentChange}
                        onNormalizeToggle={handleNormalizeToggle}
                        onLinearInterpolationToggle={handleLinearInterpolationToggle}
                        onVectorChange={handleVectorChange}
                        onVectorColorChange={handleVectorColorChange}
                        onAddVector={handleAddVector}
                        onNormalizeVectors={handleNormalizeVectors}
                        onAutoNormalizeVectorsChange={handleAutoNormalizeToggle}
                        onRemoveVector={handleRemoveVector}
                        onToggleVisibility={handleToggleVectorVisibility}
                        onTChange={handleTChange}
                        onTPrecisionChange={setTPrecision}
                        onDotModeChange={setDotMode}
                        onDotSizeChange={handleDotSizeChange}
                        onFadingPathToggle={setFadingPath}
                        onFadingPathLengthChange={handleFadingPathLengthChange}
                        onFadingPathStyleChange={setFadingPathStyle}
                        onDynamicFadingPathChange={setDynamicFadingPath}
                        onShowStartMarkersChange={setShowStartMarkers}
                        onShowEndMarkersChange={setShowEndMarkers}
                        onResetTime={resetTime}
                        onPlayPause={handlePlayPause}
                        onExploreToggle={handleExploreToggle}
                        onExploreRandomizeVectorsChange={setExploreRandomizeVectors}
                        onAnimationConfigChange={setAnimationConfig}
                        onRepeatToggle={handleRepeatToggle}
                        onActivationConfigChange={setActivation}
                        onCompareBackendsChange={handleCompareBackendsToggle}
                        onMatrixBackendChange={handleMatrixBackendChange}
                        onNavigationSensitivityChange={setNavigationSensitivity}
                        onAddWall={handleAddWall}
                        onUpdateWall={handleUpdateWall}
                        onRemoveWall={handleRemoveWall}
                        profileSummaries={profileSummaries}
                        activeProfileName={activeProfileName}
                        onProfileSave={handleProfileSave}
                        onProfileLoad={handleProfileLoad}
                        onProfileDelete={handleProfileDelete}
                        error={error}
                        backendError={backendError}
                        onCollapse={() => setControlsPanelVisible(false)}
                    />
                )}
                <div className="flex-grow h-1/2 md:h-full w-full md:w-auto relative pointer-events-none">
                     <div className="absolute inset-0 pointer-events-auto" data-tour-id="tour-scene">
                        <Scene
                            sceneData={sceneData}
                            walls={walls}
                            dotMode={dotMode}
                            dotSize={dotSize}
                            fadingPath={fadingPath}
                        fadingPathLength={fadingPathLength}
                        fadingPathStyle={fadingPathStyle}
                        showStartMarkers={showStartMarkers}
                        showEndMarkers={showEndMarkers}
                        dynamicFadingPath={dynamicFadingPath}
                        navigationSensitivity={navigationSensitivity}
                    />
                        {compareBackends && vectorTransformationsResult.visualizations.length > 0 && (
                            <div className="absolute bottom-6 left-6 bg-gray-900/80 border border-gray-700 rounded-xl p-4 text-sm text-gray-200 shadow-xl pointer-events-auto">
                                <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">Path Legend</p>
                                <div className="space-y-2">
                                    {vectorTransformationsResult.visualizations.map(viz => (
                                        <div key={viz.backend} className="flex items-center gap-2">
                                            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: viz.color }} />
                                            <span>{viz.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                     </div>
                     {!controlsPanelVisible && (
                        <button
                            onClick={() => setControlsPanelVisible(true)}
                            className="absolute top-6 left-6 px-4 py-2 rounded-lg bg-gray-900/80 border border-gray-700 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors pointer-events-auto shadow-lg"
                        >
                            Show Controls
                        </button>
                     )}
                     {infoPanelVisible ? (
                        <InfoPanel
                            baseMatrix={matrixA}
                            effectiveMatrix={matrixPreparation.matrix}
                            matrixScalar={matrixScalar}
                            matrixExponent={matrixPreparation.exponent}
                            normalizeRequested={normalizeMatrix}
                            normalizeApplied={matrixPreparation.normalizationApplied}
                            determinantBefore={matrixPreparation.determinantBefore}
                            determinantAfter={matrixPreparation.determinantAfter}
                            normalizationWarning={normalizationWarning}
                            walls={walls}
                            wallContactCounts={wallContactCounts}
                            eigenvalues={effectiveEigenvalues}
                            eigenvaluesAtT={matrixAtEigenvalues}
                            matrixAt={matrixAt}
                            determinantAtT={matrixAtDeterminant}
                            vectorV={firstVisibleVector?.value || null}
                            rawTransformedV={rawTransformedV}
                            transformedV={firstVisibleSceneData?.interpolatedVector ? [firstVisibleSceneData.interpolatedVector.x, firstVisibleSceneData.interpolatedVector.y] : null}
                            activationFnName={activation.name}
                            customActivationFnStr={activation.customFnStr}
                            onCollapse={() => setInfoPanelVisible(false)}
                        />
                     ) : (
                        <button
                            onClick={() => setInfoPanelVisible(true)}
                            className="absolute top-6 right-6 px-4 py-2 rounded-lg bg-gray-900/80 border border-gray-700 text-cyan-300 hover:text-white hover:border-cyan-400 transition-colors pointer-events-auto shadow-lg"
                        >
                            Show Info
                        </button>
                     )}
                </div>
            </div>
            <GuidedTour
                active={tourActive}
                stepIndex={tourStepIndex}
                steps={TOUR_STEPS}
                onNext={handleTourNext}
                onPrev={handleTourPrev}
                onExit={handleTourExit}
            />
        </>
    );
}

export default App;

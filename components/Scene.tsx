import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { SceneVectorEntry, Wall, FadingPathStyle, Point2 } from '../types';

interface SceneProps {
   sceneData: SceneVectorEntry[];
   walls: Wall[];
   dotMode: boolean;
   dotSize: number;
   fadingPath: boolean;
   fadingPathLength: number;
   fadingPathStyle: FadingPathStyle;
   showStartMarkers: boolean;
   showEndMarkers: boolean;
   dynamicFadingPath: boolean;
   navigationSensitivity: number;
}

type ProjectedPoint = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const MIN_EXTENT = 12;
const PADDING = 4;
const MIN_VIEW_WIDTH = 320;

const Scene: React.FC<SceneProps> = React.memo(({
    sceneData,
    walls,
    dotMode,
    dotSize,
    fadingPath,
    fadingPathLength: _fadingPathLength,
    fadingPathStyle,
    showStartMarkers,
    showEndMarkers,
    dynamicFadingPath: _dynamicFadingPath,
    navigationSensitivity
}) => {
    const [pan, setPan] = useState<Point2>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState<number>(1);
    const [hover, setHover] = useState<Point2 | null>(null);
    const dragRef = useRef<{ x: number; y: number } | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);

    const bounds = useMemo(() => {
        const pts: Point2[] = [];
        sceneData.forEach(entry => {
            pts.push(entry.initialVector);
            if (entry.finalVector) pts.push(entry.finalVector);
            if (entry.interpolatedVector) pts.push(entry.interpolatedVector);
            entry.path.forEach(p => pts.push(p));
            entry.contacts.forEach(c => pts.push(c.point));
        });
        walls.forEach(wall => {
            if (wall.axis === 'x') {
                pts.push({ x: wall.position, y: 0 });
            } else {
                pts.push({ x: 0, y: wall.position });
            }
        });

        if (pts.length === 0) {
            pts.push({ x: -2, y: -2 }, { x: 2, y: 2 }, { x: 0, y: 0 });
        }

        const xs = pts.map(p => p.x);
        const ys = pts.map(p => p.y);
        const rawMinX = Math.min(...xs);
        const rawMaxX = Math.max(...xs);
        const rawMinY = Math.min(...ys);
        const rawMaxY = Math.max(...ys);
        const centerX = (rawMinX + rawMaxX) / 2;
        const centerY = (rawMinY + rawMaxY) / 2;
        const baseSpanX = Math.max(2, rawMaxX - rawMinX);
        const baseSpanY = Math.max(2, rawMaxY - rawMinY);

        const paddedSpanX = baseSpanX + PADDING * 2;
        const paddedSpanY = baseSpanY + PADDING * 2;
        const targetSpanX = Math.max(paddedSpanX, MIN_EXTENT);
        const targetSpanY = Math.max(paddedSpanY, MIN_EXTENT);

        const minX = centerX - targetSpanX / 2;
        const maxX = centerX + targetSpanX / 2;
        const minY = centerY - targetSpanY / 2;
        const maxY = centerY + targetSpanY / 2;

        return { centerX, centerY, minX, maxX, minY, maxY, spanX: targetSpanX, spanY: targetSpanY };
    }, [sceneData, walls]);

    const viewBounds = useMemo(() => {
        const spanX = bounds.spanX / zoom;
        const spanY = bounds.spanY / zoom;
        const minX = bounds.centerX + pan.x - spanX / 2;
        const maxX = bounds.centerX + pan.x + spanX / 2;
        const minY = bounds.centerY + pan.y - spanY / 2;
        const maxY = bounds.centerY + pan.y + spanY / 2;
        return { minX, maxX, minY, maxY, spanX, spanY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
    }, [bounds, pan.x, pan.y, zoom]);

    const viewSizeRef = useRef({ width: MIN_VIEW_WIDTH, height: MIN_VIEW_WIDTH * 0.7 });
    const [viewSize, setViewSize] = useState({ width: MIN_VIEW_WIDTH, height: MIN_VIEW_WIDTH * 0.7 });

    React.useEffect(() => {
        const el = svgRef.current?.parentElement;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            const w = Math.max(MIN_VIEW_WIDTH, entry.contentRect.width);
            const h = Math.max(240, entry.contentRect.height);
            viewSizeRef.current = { width: w, height: h };
            setViewSize({ width: w, height: h });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const view = useMemo(() => {
        const width = viewSize.width;
        const height = viewSize.height;
        const project = (p: Point2): ProjectedPoint => ({
            x: ((p.x - viewBounds.minX) / viewBounds.spanX) * width,
            y: height - ((p.y - viewBounds.minY) / viewBounds.spanY) * height
        });
        return { width, height, project };
    }, [viewBounds, viewSize]);

    const unproject = useCallback((px: number, py: number): Point2 => {
        return {
            x: viewBounds.minX + (px / view.width) * viewBounds.spanX,
            y: viewBounds.maxY - (py / view.height) * viewBounds.spanY
        };
    }, [view.width, view.height, viewBounds]);

    const origin = useMemo(() => view.project({ x: 0, y: 0 }), [view]);
    const axisStroke = Math.max(0.25, view.width / 160);
    const markerRadius = Math.max(0.6, dotSize * 14);
    const pathStroke = Math.max(0.4, view.width / 180);

    const renderArrow = (target: Point2, color: string, opacity = 1, widthScale = 1) => {
        const tip = view.project(target);
        const dx = tip.x - origin.x;
        const dy = tip.y - origin.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.001) return null;
        const nx = dx / len;
        const ny = dy / len;
        const headLength = Math.max(3, Math.min(len * 0.22, 10));
        const headWidth = headLength * 0.7;
        const baseX = tip.x - nx * headLength;
        const baseY = tip.y - ny * headLength;
        const left: ProjectedPoint = { x: baseX + -ny * headWidth, y: baseY + nx * headWidth };
        const right: ProjectedPoint = { x: baseX - -ny * headWidth, y: baseY - nx * headWidth };
        return (
            <g stroke={color} fill={color} opacity={opacity} strokeWidth={pathStroke * widthScale}>
                <line x1={origin.x} y1={origin.y} x2={baseX} y2={baseY} />
                <path d={`M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y} Z`} />
            </g>
        );
    };

    const renderPath = (points: Point2[], color: string, style: FadingPathStyle) => {
        if (points.length < 2) return null;
        const projected = points.map(view.project);
        if (!fadingPath || style === 'smooth') {
            const d = projected.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            const opacity = fadingPath ? 0.9 : 1;
            return (
                <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={pathStroke * 1.3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={opacity}
                />
            );
        }

        const interval = Math.max(1, Math.floor(points.length / 24));
        const sampled = projected.filter((_, idx) => idx % interval === 0 || idx === projected.length - 1);
        return (
            <>
                {sampled.map((p, idx) => {
                    const ratio = sampled.length <= 1 ? 1 : idx / (sampled.length - 1);
                    const alpha = Math.max(0.25, ratio);
                    return (
                        <circle
                            key={`${p.x}-${p.y}-${idx}`}
                            cx={p.x}
                            cy={p.y}
                            r={markerRadius * 0.4}
                            fill={color}
                            opacity={alpha}
                        />
                    );
                })}
            </>
        );
    };

    const originLines = useMemo(() => {
        const xZero = clamp((0 - viewBounds.minX) / viewBounds.spanX, 0, 1) * view.width;
        const yZero = view.height - clamp((0 - viewBounds.minY) / viewBounds.spanY, 0, 1) * view.height;
        return (
            <>
                <line x1={xZero} y1={0} x2={xZero} y2={view.height} stroke="rgba(148,163,184,0.35)" strokeWidth={axisStroke} />
                <line x1={0} y1={yZero} x2={view.width} y2={yZero} stroke="rgba(148,163,184,0.35)" strokeWidth={axisStroke} />
            </>
        );
    }, [viewBounds.minX, viewBounds.minY, viewBounds.spanX, viewBounds.spanY, view.width, view.height, axisStroke]);

    const wallLines = useMemo(() => {
        return walls.map(wall => {
            if (wall.axis === 'x') {
                const xPos = ((wall.position - viewBounds.minX) / viewBounds.spanX) * view.width;
                return (
                    <line
                        key={wall.id}
                        x1={xPos}
                        x2={xPos}
                        y1={0}
                        y2={view.height}
                        stroke="rgba(56,189,248,0.35)"
                        strokeDasharray="6 4"
                        strokeWidth={axisStroke}
                    />
                );
            }
            const yPos = view.height - ((wall.position - viewBounds.minY) / viewBounds.spanY) * view.height;
            return (
                <line
                    key={wall.id}
                    x1={0}
                    x2={view.width}
                    y1={yPos}
                    y2={yPos}
                    stroke="rgba(56,189,248,0.35)"
                    strokeDasharray="6 4"
                    strokeWidth={axisStroke}
                />
            );
        });
    }, [walls, viewBounds.minX, viewBounds.spanX, viewBounds.minY, viewBounds.spanY, view.width, view.height, axisStroke]);

    const contactHighlights = useMemo(() => {
        return sceneData.flatMap(entry =>
            entry.contacts.map(contact => {
                const point = view.project(contact.point);
                return { ...contact, screen: point, color: entry.color };
            })
        );
    }, [sceneData, view]);

    const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        setHover(unproject(px, py));

        if (dragRef.current) {
            const dx = event.clientX - dragRef.current.x;
            const dy = event.clientY - dragRef.current.y;
            dragRef.current = { x: event.clientX, y: event.clientY };
            setPan(prev => ({
                x: prev.x - dx * (viewBounds.spanX / view.width) * navigationSensitivity,
                y: prev.y + dy * (viewBounds.spanY / view.height) * navigationSensitivity
            }));
        }
    }, [unproject, viewBounds.spanX, viewBounds.spanY, view.width, view.height, navigationSensitivity]);

    const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
        dragRef.current = { x: event.clientX, y: event.clientY };
    }, []);

    const endDrag = useCallback(() => {
        dragRef.current = null;
    }, []);

    const handleWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
        event.preventDefault();
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const pointerWorld = unproject(px, py);
        const rX = px / view.width;
        const rY = py / view.height;

        const step = 0.08 * navigationSensitivity;
        const factor = event.deltaY > 0 ? Math.max(0.05, 1 - step) : 1 + step;
        const nextZoom = clamp(zoom * factor, 0.4, 12);
        const newSpanX = bounds.spanX / nextZoom;
        const newSpanY = bounds.spanY / nextZoom;
        const newMinX = pointerWorld.x - rX * newSpanX;
        const newMaxY = pointerWorld.y + (1 - rY) * newSpanY;
        const newCenterX = newMinX + newSpanX / 2;
        const newCenterY = newMaxY - newSpanY / 2;

        setPan({
            x: newCenterX - bounds.centerX,
            y: newCenterY - bounds.centerY
        });
        setZoom(nextZoom);
    }, [unproject, view.width, view.height, zoom, bounds.spanX, bounds.spanY, bounds.centerX, bounds.centerY, navigationSensitivity]);

    const resetView = useCallback(() => {
        setPan({ x: 0, y: 0 });
        setZoom(1);
    }, []);

    return (
        <div className="w-full h-full bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 relative">
            <svg
                ref={svgRef}
                viewBox={`0 0 ${view.width} ${view.height}`}
                className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
                onPointerMove={handlePointerMove}
                onPointerDown={handlePointerDown}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
                onWheel={handleWheel}
                onDoubleClick={resetView}
            >
                <defs>
                    <pattern id="grid" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
                        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(51,65,85,0.4)" strokeWidth="0.4" />
                    </pattern>
                    <radialGradient id="contactGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
                        <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
                    </radialGradient>
                </defs>
                <rect width={view.width} height={view.height} fill="url(#grid)" />
                {originLines}
                {wallLines}

                {sceneData.map(entry => (
                    <g key={entry.id}>
                        {renderPath(entry.path, entry.color, fadingPathStyle)}
                    </g>
                ))}

                {contactHighlights.map(contact => (
                    <g key={`${contact.wallId}-${contact.screen.x}-${contact.screen.y}`}>
                        <circle cx={contact.screen.x} cy={contact.screen.y} r={markerRadius * 1.4} fill="url(#contactGlow)" />
                        <circle cx={contact.screen.x} cy={contact.screen.y} r={markerRadius * 0.9} fill={contact.color} opacity={0.9} />
                    </g>
                ))}

                {sceneData.map(entry => {
                    const initial = view.project(entry.initialVector);
                    const final = entry.finalVector ? view.project(entry.finalVector) : null;
                    const current = entry.interpolatedVector ? view.project(entry.interpolatedVector) : null;
                    const currentColor = '#fde047';

                    return (
                        <g key={`${entry.id}-markers`}>
                            {dotMode ? (
                                <>
                                    {showStartMarkers && (
                                        <circle cx={initial.x} cy={initial.y} r={markerRadius} fill={entry.color} opacity={0.95} />
                                    )}
                                    {showEndMarkers && final && (
                                        <circle cx={final.x} cy={final.y} r={markerRadius} fill={entry.color} opacity={0.45} />
                                    )}
                                    {current && (
                                        <circle cx={current.x} cy={current.y} r={markerRadius * 0.9} fill={currentColor} stroke="black" strokeWidth={0.3} />
                                    )}
                                </>
                            ) : (
                                <>
                                    {showStartMarkers && renderArrow(entry.initialVector, entry.color, 0.95)}
                                    {showEndMarkers && final && renderArrow(entry.finalVector!, entry.color, 0.45, 0.9)}
                                    {current && renderArrow(entry.interpolatedVector || entry.initialVector, currentColor, 1, 1.05)}
                                </>
                            )}
                        </g>
                    );
                })}
            </svg>
            <div className="absolute top-3 left-3 bg-gray-900/80 text-gray-200 text-xs px-3 py-2 rounded-lg border border-gray-700 shadow pointer-events-none select-none">
                <div className="font-semibold text-cyan-300">Navigation</div>
                <div>Drag to pan • Scroll to zoom</div>
                <div>Double-click to reset view</div>
                {hover && (
                    <div className="mt-1 text-[11px] text-gray-300 font-mono">
                        hover: ({hover.x.toFixed(2)}, {hover.y.toFixed(2)})
                    </div>
                )}
            </div>
        </div>
    );
});

Scene.displayName = 'Scene';

export default Scene;

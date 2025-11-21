import React, { useEffect, useState, useCallback } from 'react';
import type { ControlsPanelTab } from './ControlsPanel';

export type TourStep = {
    id: string;
    title: string;
    description: string;
    selector: string;
    tab?: ControlsPanelTab | 'none';
    spotlightPadding?: number;
};

interface GuidedTourProps {
    active: boolean;
    stepIndex: number;
    steps: TourStep[];
    onNext: () => void;
    onPrev: () => void;
    onExit: () => void;
}

const defaultPadding = 16;

const GuidedTour: React.FC<GuidedTourProps> = ({
    active,
    stepIndex,
    steps,
    onNext,
    onPrev,
    onExit
}) => {
    const step = steps[stepIndex];
    const [rect, setRect] = useState<DOMRect | null>(null);

    const updateSpotlight = useCallback(() => {
        if (!active || !step) {
            setRect(null);
            return;
        }
        const target = document.querySelector(step.selector) as HTMLElement | null;
        if (target) {
            setRect(target.getBoundingClientRect());
        } else {
            setRect(null);
        }
    }, [active, step]);

    useEffect(() => {
        if (!active) return;
        updateSpotlight();
        const rerender = () => updateSpotlight();
        window.addEventListener('resize', rerender);
        window.addEventListener('scroll', rerender, true);
        const interval = window.setInterval(rerender, 600);
        return () => {
            window.removeEventListener('resize', rerender);
            window.removeEventListener('scroll', rerender, true);
            window.clearInterval(interval);
        };
    }, [active, updateSpotlight]);

    useEffect(() => {
        if (active) {
            const timeout = window.setTimeout(updateSpotlight, 80);
            return () => window.clearTimeout(timeout);
        }
    }, [active, stepIndex, updateSpotlight]);

    if (!active || !step) return null;

    const padding = step.spotlightPadding ?? defaultPadding;
    const hasSpotlight = Boolean(rect);
    const spotlightStyle = rect
        ? {
            left: rect.left + window.scrollX - padding,
            top: rect.top + window.scrollY - padding,
            width: rect.width + padding * 2,
            height: rect.height + padding * 2
        }
        : {
            left: '5%',
            top: '10%',
            width: '90%',
            height: '70%'
        };

    const isLast = stepIndex === steps.length - 1;

    return (
        <div className="pointer-events-none fixed inset-0 z-50">
            <div
                className="fixed rounded-xl border-2 border-cyan-400/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] transition-all duration-200 ease-out"
                style={spotlightStyle}
            />

            <div className="pointer-events-auto fixed bottom-6 left-1/2 -translate-x-1/2 w-[min(960px,calc(100%-2rem))] rounded-2xl bg-gray-900/90 border border-gray-700/70 shadow-2xl p-5 backdrop-blur">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div className="flex-1">
                        <p className="text-xs uppercase tracking-wide text-cyan-300/80 mb-1">
                            Guided tour • Step {stepIndex + 1} of {steps.length}
                        </p>
                        <h3 className="text-xl font-semibold text-white">{step.title}</h3>
                        <p className="text-sm text-gray-200 mt-2 whitespace-pre-line">{step.description}</p>
                        {!hasSpotlight && (
                            <p className="text-xs text-amber-300 mt-2">
                                We could not find the target for this step. Make sure the related panel is visible.
                            </p>
                        )}
                        <p className="text-xs text-gray-400 mt-3">
                            You can keep clicking and testing the UI; the highlight stays until you move to the next step.
                        </p>
                    </div>
                    <div className="flex flex-col items-stretch gap-2 w-full md:w-auto md:min-w-[220px]">
                        <button
                            type="button"
                            onClick={onNext}
                            disabled={isLast}
                            className={`w-full px-4 py-2 rounded-lg font-semibold transition-colors ${
                                isLast
                                    ? 'bg-gray-800 text-gray-400 cursor-not-allowed border border-gray-700'
                                    : 'bg-cyan-500 hover:bg-cyan-400 text-gray-900'
                            }`}
                        >
                            {isLast ? 'Final step' : 'Next'}
                        </button>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={onPrev}
                                className="flex-1 px-4 py-2 rounded-lg bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
                                disabled={stepIndex === 0}
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                onClick={onExit}
                                className="flex-1 px-4 py-2 rounded-lg bg-gray-800 text-red-300 hover:bg-red-700/60 border border-red-500/40 transition-colors"
                            >
                                Skip tour
                            </button>
                        </div>
                        <p className="text-[11px] text-gray-400 text-center">
                            Use Skip Tour to exit; clicking around will never dismiss the guide.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GuidedTour;

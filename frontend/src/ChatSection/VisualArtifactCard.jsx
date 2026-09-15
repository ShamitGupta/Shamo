import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import styles from './VisualArtifactCard.module.css';
import { sanitizeLatex } from '../utils/sanitizeLatex.js';

const DESMOS_SCRIPT_BASE = 'https://www.desmos.com/api/v1.11/calculator.js';
const GEOGEBRA_SCRIPT_URL = 'https://www.geogebra.org/apps/deployggb.js';

const scriptPromises = new Map();

function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (scriptPromises.has(src)) return scriptPromises.get(src);

    const promise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(window[globalName]), { once: true });
            existing.addEventListener('error', reject, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve(window[globalName]);
        script.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(script);
    });

    scriptPromises.set(src, promise);
    return promise;
}

function Markdown({ children }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {sanitizeLatex(children || '')}
        </ReactMarkdown>
    );
}

function mapDesmosExpression(expression, Desmos) {
    const mapped = {
        id: expression.id,
        latex: expression.latex,
        hidden: expression.hidden,
        secret: expression.secret,
    };

    for (const key of ['color', 'points', 'lines', 'fill', 'fillOpacity', 'sliderBounds', 'domain', 'label', 'showLabel']) {
        if (expression[key] !== undefined && expression[key] !== null) {
            mapped[key] = expression[key];
        }
    }

    if (expression.lineStyle && Desmos?.Styles?.[expression.lineStyle]) {
        mapped.lineStyle = Desmos.Styles[expression.lineStyle];
    }
    if (expression.pointStyle && Desmos?.Styles?.[expression.pointStyle]) {
        mapped.pointStyle = Desmos.Styles[expression.pointStyle];
    }

    return mapped;
}

function DesmosVisual({ artifact, onError }) {
    const containerRef = useRef(null);
    const calculatorRef = useRef(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const apiKey = import.meta.env.VITE_DESMOS_API_KEY;
        if (!apiKey) {
            onError('Desmos is not configured. Add VITE_DESMOS_API_KEY to frontend/.env.');
            return undefined;
        }

        const scriptUrl = `${DESMOS_SCRIPT_BASE}?apiKey=${encodeURIComponent(apiKey)}`;
        loadScript(scriptUrl, 'Desmos')
            .then((Desmos) => {
                if (cancelled || !containerRef.current) return;
                const options = {
                    expressions: true,
                    settingsMenu: false,
                    expressionsTopbar: false,
                    keypad: false,
                    invertedColors: true,
                    degreeMode: Boolean(artifact.desmos?.degreeMode),
                    graphDescription: artifact.accessibility_text,
                };
                const calculator = artifact.artifact_kind === 'desmos_3d'
                    ? Desmos.Calculator3D(containerRef.current, options)
                    : Desmos.GraphingCalculator(containerRef.current, options);
                calculatorRef.current = calculator;

                if (artifact.desmos?.viewport && calculator.setMathBounds) {
                    calculator.setMathBounds(artifact.desmos.viewport);
                }

                artifact.desmos?.expressions?.forEach((expression) => {
                    calculator.setExpression(mapDesmosExpression(expression, Desmos));
                });

                if (calculator.observe) {
                    calculator.observe('expressionAnalysis', () => {
                        const analysis = calculator.expressionAnalysis || {};
                        const requiredIds = new Set(
                            (artifact.desmos?.expressions || [])
                                .filter((expression) => expression.required !== false)
                                .map((expression) => expression.id)
                        );
                        const failed = Object.entries(analysis).find(([id, result]) =>
                            requiredIds.has(id) && result?.isError
                        );
                        if (failed) {
                            onError(failed[1]?.errorMessage || 'Desmos reported an expression error.');
                        }
                    });
                }

                setReady(true);
            })
            .catch((error) => onError(error.message));

        return () => {
            cancelled = true;
            calculatorRef.current?.destroy?.();
            calculatorRef.current = null;
        };
    }, [artifact, onError]);

    return (
        <div className={styles.VisualShell}>
            {!ready && <div className={styles.Loading}>Preparing graph...</div>}
            <div ref={containerRef} className={styles.Calculator} aria-label={artifact.accessibility_text} />
        </div>
    );
}

function GeoGebraVisual({ artifact, onError }) {
    const containerId = useId().replace(/:/g, '_');
    const containerRef = useRef(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const container = containerRef.current;

        loadScript(GEOGEBRA_SCRIPT_URL, 'GGBApplet')
            .then((GGBApplet) => {
                if (cancelled || !container) return;

                const params = {
                    appName: artifact.geogebra?.appName || 'geometry',
                    width: 760,
                    height: 430,
                    showToolBar: false,
                    showAlgebraInput: false,
                    showMenuBar: false,
                    enableLabelDrags: false,
                    enableShiftDragZoom: true,
                    appletOnLoad: (api) => {
                        try {
                            for (const command of artifact.geogebra?.commands || []) {
                                if (api.evalCommand(command) === false) {
                                    throw new Error(`GeoGebra rejected: ${command}`);
                                }
                            }
                            for (const slider of artifact.geogebra?.sliders || []) {
                                api.evalCommand(`${slider.name} = ${slider.value}`);
                                api.setValue(slider.name, slider.value);
                            }
                            if (!cancelled) setReady(true);
                        } catch (error) {
                            onError(error.message);
                        }
                    },
                };

                const applet = new GGBApplet(params, true);
                applet.inject(containerId);
            })
            .catch((error) => onError(error.message));

        return () => {
            cancelled = true;
            if (container) {
                container.innerHTML = '';
            }
        };
    }, [artifact, containerId, onError]);

    return (
        <div className={styles.VisualShell}>
            {!ready && <div className={styles.Loading}>Preparing construction...</div>}
            <div id={containerId} ref={containerRef} className={styles.Calculator} aria-label={artifact.accessibility_text} />
        </div>
    );
}

function ManimVisual({ artifact, onError }) {
    const [ready, setReady] = useState(false);
    const hasVideo = Boolean(artifact.video_url);

    useEffect(() => {
        if (!hasVideo) {
            // The backend already drops a manim artifact whose render/upload
            // failed, so this path is rare -- mainly a stale cached response
            // shape from before that artifact was resolved. Treat it the
            // same as any other render failure: fall back to text, not a
            // dead player.
            onError('The animation is not available for this turn.');
        }
    }, [hasVideo, onError]);

    if (!hasVideo) return null;

    return (
        <div className={styles.VisualShell}>
            {!ready && <div className={styles.Loading}>Preparing animation...</div>}
            <video
                className={styles.Video}
                src={artifact.video_url}
                controls
                loop
                playsInline
                preload="metadata"
                aria-label={artifact.accessibility_text}
                onCanPlay={() => setReady(true)}
                onError={() => onError('The animation could not be loaded.')}
            />
        </div>
    );
}

function VisualArtifactCard({ artifact, fallbackMarkdown }) {
    const [renderError, setRenderError] = useState(null);
    const isDesmos = artifact.artifact_kind?.startsWith('desmos_');
    const isGeoGebra = artifact.artifact_kind?.startsWith('geogebra_');
    const isManim = artifact.artifact_kind === 'manim_template_video';

    return (
        <section className={styles.Card}>
            <div className={styles.Header}>
                <div>
                    <h3 className={styles.Title}>{artifact.title}</h3>
                    <p className={styles.Purpose}>{artifact.purpose}</p>
                </div>
                {artifact.part_label && <span className={styles.Part}>{artifact.part_label}</span>}
            </div>

            <div className={styles.Narration}>
                <Markdown>{artifact.narration_markdown}</Markdown>
            </div>

            {artifact.teaching_steps?.length > 0 && (
                <div className={styles.TeachingSteps}>
                    {artifact.teaching_steps.map((step, index) => (
                        <div key={`${artifact.title}-step-${index}`} className={styles.TeachingStep}>
                            <span className={styles.TeachingLabel}>{step.label}</span>
                            <div className={styles.TeachingText}>
                                <Markdown>{step.explanation_markdown}</Markdown>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {renderError ? (
                <div className={styles.Fallback}>
                    <strong>Visual unavailable.</strong>
                    <Markdown>{fallbackMarkdown || artifact.accessibility_text || renderError}</Markdown>
                </div>
            ) : isDesmos ? (
                <DesmosVisual artifact={artifact} onError={setRenderError} />
            ) : isGeoGebra ? (
                <GeoGebraVisual artifact={artifact} onError={setRenderError} />
            ) : isManim ? (
                <ManimVisual artifact={artifact} onError={setRenderError} />
            ) : (
                <div className={styles.Fallback}>
                    <Markdown>{fallbackMarkdown || artifact.accessibility_text}</Markdown>
                </div>
            )}

            <p className={styles.Accessibility}>{artifact.accessibility_text}</p>
        </section>
    );
}

export default VisualArtifactCard;

// Shows the question the tutor is grounded in, including its diagrams.
//
// Worth having for its own sake -- a student should see what they are being
// taught -- but it also does something the old app could not: it proves the
// retrieval worked. If the panel shows the right question, the tutor is reading
// the right question, because both come from the same call.
//
// Diagrams arrive as signed URLs into a private bucket and expire after ten
// minutes. A failed image is reported rather than left as a broken icon, since
// "the diagram did not load" and "there is no diagram" mean different things to
// someone trying to solve the problem.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import styles from './QuestionPanel.module.css';
import { sanitizeLatex } from '../utils/sanitizeLatex.js';
import { SESSION_LABELS } from '../api/tutorApi.js';

function Diagram({ asset }) {
    const [failed, setFailed] = useState(false);

    if (!asset.url || failed) {
        return (
            <div className={styles.DiagramMissing}>
                <strong>Diagram unavailable.</strong>{' '}
                {asset.description || 'No description was recorded.'}
            </div>
        );
    }

    return (
        <figure className={styles.Figure}>
            <img
                src={asset.url}
                alt={asset.description || 'Question diagram'}
                className={styles.DiagramImage}
                onError={() => setFailed(true)}
            />
            {asset.description && (
                <figcaption className={styles.Caption}>
                    <Markdown>{asset.description}</Markdown>
                </figcaption>
            )}
        </figure>
    );
}

function Markdown({ children }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {sanitizeLatex(children || '')}
        </ReactMarkdown>
    );
}

function QuestionPanel({ question, isLoading, error, onDismiss }) {
    const [collapsed, setCollapsed] = useState(false);

    if (isLoading) {
        return <div className={styles.Panel}><p className={styles.Muted}>Loading question…</p></div>;
    }

    if (error) {
        return (
            <div className={`${styles.Panel} ${styles.PanelError}`}>
                <p className={styles.ErrorText}>{error}</p>
                {onDismiss && (
                    <button type="button" className={styles.TextButton} onClick={onDismiss}>
                        Dismiss
                    </button>
                )}
            </div>
        );
    }

    if (!question) return null;

    const sessionLabel = SESSION_LABELS[question.exam_session] || question.exam_session;
    // syllabus_code is echoed back by the API rather than assumed, since the
    // corpus now holds more than one syllabus (9709 A-level, 0606 IGCSE).
    const syllabusCode = question.syllabus_code || '9709';
    const title =
        `${syllabusCode}/${question.paper_variant} ${sessionLabel} ${question.year} — ` +
        `Question ${question.question_number}`;

    return (
        <div className={styles.Panel}>
            <div className={styles.Header}>
                <div>
                    <h2 className={styles.Title}>{title}</h2>
                    {question.total_marks != null && (
                        <span className={styles.Marks}>{question.total_marks} marks</span>
                    )}
                </div>
                <button
                    type="button"
                    className={styles.TextButton}
                    onClick={() => setCollapsed((c) => !c)}
                    aria-expanded={!collapsed}
                >
                    {collapsed ? 'Show question' : 'Hide question'}
                </button>
            </div>

            {!collapsed && (
                <div className={styles.Body}>
                    {question.stem_markdown && (
                        <div className={styles.Stem}>
                            <Markdown>{question.stem_markdown}</Markdown>
                        </div>
                    )}

                    {question.assets?.map((asset, index) => (
                        <Diagram key={index} asset={asset} />
                    ))}

                    {question.parts?.map((part, index) => (
                        <div key={index} className={styles.Part}>
                            <div className={styles.PartHeader}>
                                <span className={styles.PartLabel}>{part.label}</span>
                                {part.marks != null && (
                                    <span className={styles.PartMarks}>[{part.marks}]</span>
                                )}
                            </div>
                            <Markdown>{part.prompt_markdown}</Markdown>
                        </div>
                    ))}

                    {/* The mark scheme is deliberately NOT rendered. The tutor
                        reads it; showing it here would turn the app into a
                        answer sheet and remove any reason to be taught. */}
                </div>
            )}
        </div>
    );
}

export default QuestionPanel;

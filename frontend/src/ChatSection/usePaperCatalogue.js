// Selector options derived from what is actually published.
//
// This replaces utils/variantRules.js, which returned a fixed list of variants
// per subject and session regardless of the corpus, alongside a hardcoded year
// range ending at 2024 and a question list that always ran 1 to 15. Between
// them a student could select 2021 / variant 13 / question 15 -- a combination
// that has never existed -- and the app would ask about it anyway.
//
// Here every level narrows the next, and each only offers values the catalogue
// contains. Picking something unavailable is not validated against; it is not
// offerable.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchPapers, SESSION_LABELS } from '../api/tutorApi.js';

const SESSION_ORDER = ['feb_march', 'may_june', 'oct_nov'];

export function usePaperCatalogue() {
    const [papers, setPapers] = useState([]);
    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [error, setError] = useState(null);

    const [year, setYear] = useState('');
    const [session, setSession] = useState('');
    const [variant, setVariant] = useState('');
    const [questionNum, setQuestionNum] = useState('');

    useEffect(() => {
        let cancelled = false;
        fetchPapers()
            .then((data) => {
                if (cancelled) return;
                setPapers(data);
                setStatus('ready');
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err.message);
                setStatus('error');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const years = useMemo(
        () => [...new Set(papers.map((p) => p.year))].sort((a, b) => b - a),
        [papers],
    );

    const sessions = useMemo(() => {
        if (!year) return [];
        const found = new Set(
            papers.filter((p) => String(p.year) === String(year)).map((p) => p.exam_session),
        );
        return SESSION_ORDER.filter((s) => found.has(s));
    }, [papers, year]);

    // Stale choices are DERIVED away rather than cleared in an effect.
    //
    // Changing the year can invalidate the session below it, and so on down the
    // chain. Clearing each one with a useEffect works but sets state during
    // render, which React 19 flags as a cascading render -- and it really is
    // one: four renders to settle a single click. Treating an out-of-range
    // choice as empty gets the same result in one pass, and the raw state is
    // harmless because nothing downstream ever reads it.
    const effectiveSession = session && sessions.includes(session) ? session : '';

    const variants = useMemo(() => {
        if (!year || !effectiveSession) return [];
        return papers
            .filter((p) => String(p.year) === String(year) && p.exam_session === effectiveSession)
            .map((p) => p.paper_variant)
            .sort();
    }, [papers, year, effectiveSession]);

    const effectiveVariant = variant && variants.includes(variant) ? variant : '';

    const selectedPaper = useMemo(
        () =>
            papers.find(
                (p) =>
                    String(p.year) === String(year) &&
                    p.exam_session === effectiveSession &&
                    p.paper_variant === effectiveVariant,
            ) || null,
        [papers, year, effectiveSession, effectiveVariant],
    );

    // Straight from the paper, so a paper with 7 questions never offers an 8th.
    const questionNumbers = useMemo(
        () => (selectedPaper ? selectedPaper.question_numbers : []),
        [selectedPaper],
    );

    const effectiveQuestion =
        questionNum && questionNumbers.includes(Number(questionNum)) ? questionNum : '';

    const reference = useMemo(() => {
        if (!year || !effectiveSession || !effectiveVariant || !effectiveQuestion) return null;
        return {
            year: Number(year),
            exam_session: effectiveSession,
            paper_variant: effectiveVariant,
            question_number: Number(effectiveQuestion),
        };
    }, [year, effectiveSession, effectiveVariant, effectiveQuestion]);

    const asOptions = useCallback(
        (values, label, formatter = String) => [
            { value: '', label: `${label} (None)` },
            ...values.map((v) => ({ value: String(v), label: formatter(v) })),
        ],
        [],
    );

    return {
        status,
        error,
        paperCount: papers.length,
        year,
        // The effective values, so a dropdown never displays a choice that the
        // level above has since invalidated.
        session: effectiveSession,
        variant: effectiveVariant,
        questionNum: effectiveQuestion,
        setYear,
        setSession,
        setVariant,
        setQuestionNum,
        reference,
        selectedPaper,
        yearOptions: asOptions(years, 'Year'),
        sessionOptions: asOptions(sessions, 'Session', (s) => SESSION_LABELS[s] || s),
        variantOptions: asOptions(variants, 'Variant'),
        questionOptions: asOptions(questionNumbers, 'Question'),
    };
}

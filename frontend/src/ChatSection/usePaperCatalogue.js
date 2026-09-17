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

// The corpus now holds more than one syllabus (9709 A-level Mathematics,
// 0606 IGCSE Additional Mathematics), and paper_variant is NOT unique across
// them -- e.g. "2025 Oct/Nov paper 12" exists in both. So subject has to be
// chosen first and every level below it filtered by subject too, or two
// different papers could collide under one set of dropdowns. This ordering
// is a display preference only, so a newly-added subject still appears
// (just after these) rather than being silently dropped.
const SUBJECT_ORDER = ['a_level:9709', 'igcse:0606'];
const QUALIFICATION_LABELS = { a_level: 'A-level', igcse: 'IGCSE' };

function subjectKey(qualification, syllabusCode) {
    return `${qualification}:${syllabusCode}`;
}

function subjectLabel(qualification, syllabusCode, subject) {
    const qualLabel = QUALIFICATION_LABELS[qualification] || qualification;
    return `${qualLabel} ${subject || 'Mathematics'} (${syllabusCode})`;
}

export function usePaperCatalogue() {
    const [papers, setPapers] = useState([]);
    const [status, setStatus] = useState('loading'); // loading | ready | error
    const [error, setError] = useState(null);

    const [subject, setSubject] = useState('');
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

    const subjects = useMemo(() => {
        const seen = new Map();
        for (const p of papers) {
            const key = subjectKey(p.qualification, p.syllabus_code);
            if (!seen.has(key)) {
                seen.set(key, {
                    value: key,
                    qualification: p.qualification,
                    syllabus_code: p.syllabus_code,
                    label: subjectLabel(p.qualification, p.syllabus_code, p.subject),
                });
            }
        }
        return [...seen.values()].sort((a, b) => {
            const ia = SUBJECT_ORDER.indexOf(a.value);
            const ib = SUBJECT_ORDER.indexOf(b.value);
            if (ia !== ib) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
            return a.label.localeCompare(b.label);
        });
    }, [papers]);

    // No "(None)" placeholder: once the catalogue has loaded there is always
    // at least one subject, and defaulting to the first (per SUBJECT_ORDER)
    // keeps the pre-existing single-syllabus experience unchanged for anyone
    // who never touches this dropdown.
    const effectiveSubject = subject && subjects.some((s) => s.value === subject) ? subject : subjects[0]?.value || '';
    const selectedSubject = subjects.find((s) => s.value === effectiveSubject) || null;

    const papersInSubject = useMemo(
        () =>
            selectedSubject
                ? papers.filter(
                      (p) => p.qualification === selectedSubject.qualification && p.syllabus_code === selectedSubject.syllabus_code,
                  )
                : [],
        [papers, selectedSubject],
    );

    const years = useMemo(
        () => [...new Set(papersInSubject.map((p) => p.year))].sort((a, b) => b - a),
        [papersInSubject],
    );

    const sessions = useMemo(() => {
        if (!year) return [];
        const found = new Set(
            papersInSubject.filter((p) => String(p.year) === String(year)).map((p) => p.exam_session),
        );
        return SESSION_ORDER.filter((s) => found.has(s));
    }, [papersInSubject, year]);

    // Stale choices are DERIVED away rather than cleared in an effect.
    //
    // Changing the year (or the subject above it) can invalidate the session
    // below it, and so on down the chain. Clearing each one with a useEffect
    // works but sets state during render, which React 19 flags as a
    // cascading render -- and it really is one: four renders to settle a
    // single click. Treating an out-of-range choice as empty gets the same
    // result in one pass, and the raw state is harmless because nothing
    // downstream ever reads it.
    const effectiveSession = session && sessions.includes(session) ? session : '';

    const variants = useMemo(() => {
        if (!year || !effectiveSession) return [];
        return papersInSubject
            .filter((p) => String(p.year) === String(year) && p.exam_session === effectiveSession)
            .map((p) => p.paper_variant)
            .sort();
    }, [papersInSubject, year, effectiveSession]);

    const effectiveVariant = variant && variants.includes(variant) ? variant : '';

    const selectedPaper = useMemo(
        () =>
            papersInSubject.find(
                (p) =>
                    String(p.year) === String(year) &&
                    p.exam_session === effectiveSession &&
                    p.paper_variant === effectiveVariant,
            ) || null,
        [papersInSubject, year, effectiveSession, effectiveVariant],
    );

    // Straight from the paper, so a paper with 7 questions never offers an 8th.
    const questionNumbers = useMemo(
        () => (selectedPaper ? selectedPaper.question_numbers : []),
        [selectedPaper],
    );

    const effectiveQuestion =
        questionNum && questionNumbers.includes(Number(questionNum)) ? questionNum : '';

    const reference = useMemo(() => {
        if (!selectedSubject || !year || !effectiveSession || !effectiveVariant || !effectiveQuestion) return null;
        return {
            year: Number(year),
            exam_session: effectiveSession,
            paper_variant: effectiveVariant,
            question_number: Number(effectiveQuestion),
            qualification: selectedSubject.qualification,
            syllabus_code: selectedSubject.syllabus_code,
        };
    }, [selectedSubject, year, effectiveSession, effectiveVariant, effectiveQuestion]);

    // Jump straight to an arbitrary published question -- used by the
    // similar-questions panel, which can point at a different paper, session,
    // year, or even syllabus than the one currently selected.
    //
    // All five raw states are set in ONE call so React batches them into a
    // single render. The derivation chain below (effectiveSession -> variants
    // -> effectiveVariant -> questionNumbers -> effectiveQuestion) then
    // settles in one pass and `reference` goes straight from the old question
    // to the new one. Setting them across separate renders would let
    // `reference` fall to null in between, which blanks the question panel and
    // clears the conversation.
    //
    // The values written are the CATALOGUE'S own strings, never the caller's.
    // effectiveVariant compares by strict string equality against `variants`,
    // so an echoed "1" where the corpus stores "01" would derive away to empty
    // and silently blank the whole selection. Resolving the paper first turns
    // that class of bug into an explicit `false` return.
    const selectReference = useCallback(
        (ref) => {
            if (!ref) return false;
            const paper = papers.find(
                (p) =>
                    p.qualification === ref.qualification &&
                    p.syllabus_code === ref.syllabus_code &&
                    String(p.year) === String(ref.year) &&
                    p.exam_session === ref.exam_session &&
                    String(p.paper_variant) === String(ref.paper_variant),
            );
            if (!paper) return false;
            if (!paper.question_numbers.includes(Number(ref.question_number))) return false;

            setSubject(subjectKey(paper.qualification, paper.syllabus_code));
            setYear(String(paper.year));
            setSession(paper.exam_session);
            setVariant(paper.paper_variant);
            setQuestionNum(String(ref.question_number));
            return true;
        },
        [papers],
    );

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
        paperCount: papersInSubject.length,
        subject: effectiveSubject,
        year,
        // The effective values, so a dropdown never displays a choice that the
        // level above has since invalidated.
        session: effectiveSession,
        variant: effectiveVariant,
        questionNum: effectiveQuestion,
        setSubject,
        setYear,
        setSession,
        setVariant,
        setQuestionNum,
        reference,
        selectReference,
        selectedPaper,
        subjectOptions: subjects.map((s) => ({ value: s.value, label: s.label })),
        yearOptions: asOptions(years, 'Year'),
        sessionOptions: asOptions(sessions, 'Session', (s) => SESSION_LABELS[s] || s),
        variantOptions: asOptions(variants, 'Variant'),
        questionOptions: asOptions(questionNumbers, 'Question'),
    };
}

// The student's own view of where their marks go.
//
// This exists for two reasons, and the second one matters as much as the first.
//
// 1. It is more actionable for the learner than for the teacher. "You know the
//    method, you are dropping the arithmetic" changes what to do tonight;
//    "you are at 52%" does not.
// 2. Shipping the teacher's version alone would mean a teacher knowing
//    something about a student that the student cannot see. That asymmetry is
//    already on this project's open list; there was no reason to widen it for
//    the sake of one endpoint.
//
// The rendering is the SAME component the dashboard uses. A student and their
// teacher must not be reading two different instruments.

import { useEffect, useState } from 'react';

import { ApiError, fetchMyMarkCodes } from '../api/tutorApi.js';
import { useAuth } from '../Auth/authContext.js';
import MarkCodeSplit from '../Teacher/MarkCodeSplit.jsx';

function MyMarkCodes({ refreshToken }) {
    const { accessToken, isAuthenticated } = useAuth();
    // Stamped with the session it was fetched for, rather than cleared in an
    // effect -- the same reasoning as WeakTopics: clearing runs a render too
    // late, so a second student signing in on one device could see a frame of
    // the first one's marks.
    const [data, setData] = useState(null);
    const [loadedFor, setLoadedFor] = useState(null);

    useEffect(() => {
        if (!isAuthenticated || !accessToken) return undefined;
        const controller = new AbortController();
        fetchMyMarkCodes(accessToken, controller.signal)
            .then((body) => {
                if (controller.signal.aborted) return;
                setData(body);
                setLoadedFor(accessToken);
            })
            .catch((err) => {
                if (controller.signal.aborted || err?.name === 'AbortError') return;
                // Deliberately quiet. This panel is a second opinion on the
                // topic ranking beside it, not something a student is waiting
                // on, and an error box here would crowd the one that matters.
                if (!(err instanceof ApiError)) return;
                setData(null);
                setLoadedFor(accessToken);
            });
        return () => controller.abort();
    }, [isAuthenticated, accessToken, refreshToken]);

    if (!isAuthenticated || loadedFor !== accessToken) return null;
    // Nothing marked yet: the topic panel above already says so, more usefully.
    if (!data || (data.groups || []).length === 0) return null;

    return <MarkCodeSplit profile={data} heading="Where your marks go" compact />;
}

export default MyMarkCodes;

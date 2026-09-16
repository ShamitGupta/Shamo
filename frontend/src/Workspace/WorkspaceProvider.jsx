import { useCallback, useMemo, useState } from 'react';

import { usePaperCatalogue } from '../ChatSection/usePaperCatalogue.js';
import { WorkspaceContext } from './workspaceContext.js';

export function WorkspaceProvider({ children }) {
    const catalogue = usePaperCatalogue();

    // Bumped after a Check turn so the topic panel re-reads. Cheaper and
    // clearer than polling, and it only fires when something could actually
    // have changed.
    const [progressToken, setProgressToken] = useState(0);
    const notifyAttemptRecorded = useCallback(() => {
        setProgressToken((token) => token + 1);
    }, []);

    const value = useMemo(
        () => ({ catalogue, progressToken, notifyAttemptRecorded }),
        [catalogue, progressToken, notifyAttemptRecorded],
    );

    return (
        <WorkspaceContext.Provider value={value}>
            {children}
        </WorkspaceContext.Provider>
    );
}

import { createContext, useContext } from 'react';

export const WorkspaceContext = createContext(null);

/**
 * The two things both the sidebar and the chat need to share.
 *
 * `catalogue` is which question is selected. It used to live inside
 * ChatSection, which was fine while only the chat could navigate -- but the
 * topic panel in the sidebar hands a student their next practice question, and
 * clicking one has to move the selection. A second, independent copy of
 * usePaperCatalogue would fetch the catalogue twice and then disagree with
 * itself about what is on screen, so there is exactly one, here.
 *
 * `progressToken` is bumped whenever a turn could have changed the student's
 * record, so the topic panel re-reads without polling.
 */
export function useWorkspace() {
    const context = useContext(WorkspaceContext);
    if (!context) {
        throw new Error('useWorkspace must be used inside WorkspaceProvider');
    }
    return context;
}

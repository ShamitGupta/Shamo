# Shamo AI Tutor - Technical Context & Implementation Details

This document contains a comprehensive breakdown of the technical implementations, design patterns, and file structures of the Shamo AI codebase. It is designed to preserve context for future development and AI agent migration.

## Directory Structure
```text
Shamo/
|-- backend/
|   |-- main.py                 # FastAPI application entry point
|   |-- extractor.py            # OpenAI GPT-4o logic and system prompts
|   |-- supabase_database.py    # Supabase client and querying logic
|   |-- classes.py              # Pydantic data models
|   |-- requirements.txt        # Python dependencies
|   `-- .env                    # Environment variables (OpenAI, Supabase)
|-- frontend/
|   |-- src/
|   |   |-- Auth/               # UI-only authentication overlay and form components
|   |   |   |-- AuthActions.jsx
|   |   |   |-- AuthOverlay.jsx
|   |   |   |-- SignUpForm.jsx
|   |   |   |-- LoginForm.jsx
|   |   |   |-- GradeSelect.jsx
|   |   |   `-- *.module.css
|   |   |-- ChatSection/        # Main chat interface and logic
|   |   |   |-- ChatSection.jsx
|   |   |   `-- ChatSection.module.css
|   |   |-- Sidebar/            # Sidebar navigation
|   |   |   |-- Sidebar.jsx
|   |   |   `-- Sidebar.module.css
|   |   |-- utils/
|   |   |   `-- variantRules.js # Logic for paper variants
|   |   |-- App.jsx             # Root component
|   |   |-- main.jsx            # React DOM rendering
|   |   `-- index.css           # Global styles
|   |-- package.json            # Node dependencies
|   `-- vite.config.js          # Vite configuration
|-- README.md                   # Product overview
|-- gemini.md                   # Task list & UI/UX refinement notes
`-- loading.md                  # Task list for loading animations
```

## Backend Implementation (`/backend`)
The backend is built with **FastAPI** and is currently deployed on Railway (`https://shamo-production.up.railway.app`).

### 1. API Endpoints (`main.py`)
- `POST /get_info`
  - **Input**: `PromptRequest` (`user_prompt: str`, `metadata: list`)
  - **Process**: Takes the metadata list (Subject, Year, Session, Variant, Question), formats it via `extractor.information_extraction`, then uses `supabase_database.retrieve_info` to fetch the specific Question Paper (QP) and Mark Scheme (MS) content from Supabase.
  - **Output**: Returns the raw text of the QP and MS, plus the extracted info.
- `POST /get_response`
  - **Input**: `PromptResponse` (`data_formatted: list`, `user_prompt: str`, `conversation_history: list`)
  - **Process**: Takes the retrieved QP and MS text and the user's prompt. Calls `extractor.user_response_stream` to generate a response via OpenAI GPT-4o.
  - **Output**: Streams the response back to the client using FastAPI's `StreamingResponse` (`text/plain`).

### 2. AI Logic (`extractor.py`)
- **Model**: Uses `gpt-4o`.
- **`information_extraction(metadata)`**: Converts the frontend string metadata array into a structured dictionary with appropriate type casting (for example, `Year` as `int`).
- **`user_response_stream(data, user_prompt, conversation_history)`**: The core AI tutor logic. The system prompt enforces strict rules:
  - act as an expert Mathematics tutor
  - use the provided Question (LaTeX) and Mark Scheme
  - select only relevant information
  - do not just solve the question; refer to the mark scheme, analyze it, and explain steps
  - format with single `$` for inline math and double `$$` for block math

### 3. Database (`supabase_database.py`)
- Uses the `supabase` Python client.
- Dynamically selects the table based on the subject:
  - `"documents"` for IGCSE
  - `"A_level Math"` for A-level
- Queries the table using a `.contains("metadata", search_criteria)` filter to match the exact paper and question.

## Frontend Implementation (`/frontend`)
The frontend is a **React + Vite** application.

### 1. Chat Interface (`ChatSection.jsx`)
This is still the most complex component, handling state, metadata selection, and API communication.

- **State Management**: Uses `useState` for input values, selected metadata (`Subject`, `Year`, `Session`, `Variant`, `Question`), chat messages array, loading state, cached paper data, and a small amount of auth-overlay UI state (`isAuthOverlayOpen`, `authMode`).
- **Metadata Logic**: Uses `utils/variantRules.js` to dynamically render valid paper variants based on the selected subject and session.
- **Two-Step API Process**:
  1. Calls `/get_info` with the prompt and metadata to retrieve the past paper context. If the query yields no new data, it falls back to the previously cached `paperData`.
  2. Calls `/get_response` with the retrieved context and streams the output.
- **Auth UI Integration**: Mounts `AuthActions` in the top-right of the top bar and conditionally renders `AuthOverlay` above the app. The integration is intentionally shallow so the chat logic remains mostly untouched.
- **Streaming Rendering**: Uses a `TextDecoder` to read chunks from the `ReadableStream` returned by the backend and updates the `messages` state iteratively.
- **Auto-Scrolling**: Uses `requestAnimationFrame` and a `dummyRef` to ensure the chat window scrolls smoothly to the bottom as new chunks of text arrive.
- **Markdown & Math**: Uses `react-markdown` with `remark-math` and `rehype-katex` to render the AI's response, properly formatting LaTeX equations and markdown structures.

### 2. Authentication UI Layer (`src/Auth`)
The frontend now includes a **UI-only unauthenticated account-access layer**. This does **not** perform real authentication yet, but it establishes the interaction model and component boundaries for later Supabase integration.

- **`AuthActions.jsx`**
  - Renders the top-right `Log In` and `Sign Up` buttons visible to unauthenticated users.
  - These buttons only open the relevant modal mode; they do not perform any auth work.
- **`AuthOverlay.jsx`**
  - Renders a centered modal-style auth surface over the full chatbot viewport, including the sidebar region.
  - Targets roughly **80% of the total app viewport**, not just the `ChatSection`.
  - Supports closing via:
    - backdrop click
    - `Escape`
    - a small close button in the top-right of the form panel
  - Shows a static mode label (`Sign Up` or `Log In`) instead of an in-modal toggle, because the open state should respect whichever entry button the user clicked.
  - Includes internal scroll as a fallback for shorter viewports, but the layout is also compacted to try to avoid clipping on normal devices.
- **`SignUpForm.jsx`**
  - Collects `Name`, `Email`, `Password`, and `Grade`.
  - Includes a UI-only `Create account` submit button and a `Google` continuation button.
  - Stores form values in local React state only.
- **`LoginForm.jsx`**
  - Collects `Email` and `Password`.
  - Includes a UI-only `Log in` submit button and a `Google` continuation button.
  - Stores form values in local React state only.
- **`GradeSelect.jsx`**
  - Custom dropdown for grade selection.
  - Current grade options:
    - `IGCSE`
    - `A-levels`
  - Supports click-to-open, close-on-outside-click, close-on-escape, and hover-friendly option discovery.

### 3. Styling
- Uses CSS Modules (`ChatSection.module.css`, `Sidebar.module.css`, and the `Auth/*.module.css` files) for component-scoped styling.
- Global variables and base typography are defined in `index.css`.
- The design aims for a modern, dark SaaS aesthetic centered around `#121212` / `#212121`.
- The auth modal uses the same dark-surface language as the chatbot, but with:
  - a centered viewport overlay
  - single-column fields with more breathing room
  - a **white primary submit button** for a simpler visual hierarchy
  - a standard caret icon for the grade selector

## Recent Refinements
Based on `gemini.md` and `loading.md`, the following refinements have recently been implemented or are ongoing:

1. **Streaming Scroll Jitter**: Fixed using `requestAnimationFrame` targeting the container's `scrollHeight`.
2. **Metadata Dropdowns**: Added explicit dropdowns for Year, Session, Variant, and Question to reduce user prompt complexity.
3. **Cosmetic Overhaul**: Enhancing chat bubbles, fonts, and sidebar UI.
4. **Loading Animations**: Implemented an `isLoading` state to show a spinner between the user's submission and the start of the AI's streaming response.
5. **Authentication UI Shell**: Added a separate frontend-only auth module with `Sign Up` and `Log In` entry points, a centered modal overlay, a grade dropdown, and no backend auth wiring yet.

## Migration & Future Development Rules
- **Backend constraints**: Do not alter FastAPI endpoints or signatures without simultaneously updating the frontend fetch calls. The two-step call is necessary for the RAG architecture.
- **Prompt Engineering**: Be extremely careful when modifying the `user_response_stream` system prompt in `extractor.py`. The model must maintain its tutor persona and not devolve into an answer bot.
- **Math Rendering**: The frontend expects single `$` and double `$$` for LaTeX. Ensure any new models or prompts adhere to this formatting for `rehype-katex` to work.
- **Auth UI separation**: Keep real authentication logic out of `ChatSection.jsx` as much as possible. Future auth work should continue using the isolated `src/Auth` components rather than mixing auth behavior into the main chat flow.

## Additional Context: Session Memory Implementation
The chat interface now includes **session-scoped conversational memory**. This should be treated as part of the current baseline architecture.

### Product Requirement
- The chatbot should remember only the most recent portion of the current chat.
- No database persistence is required.
- No browser persistence is required.
- The memory can be safely lost when:
  - the page is refreshed
  - the browser tab is closed
  - the React app remounts

### Current Memory Window
- The current implementation remembers the **last 10 messages**.
- This is intended to represent approximately **5 full user/assistant exchanges**.
- The window is defined in `frontend/src/ChatSection/ChatSection.jsx` as:
  - `const MAX_SESSION_MEMORY_MESSAGES = 10;`

## Updated Backend Contract
The backend request model for `/get_response` has changed.

### `PromptResponse` (`backend/classes.py`)
The payload now includes:
- `data_formatted: list`
- `user_prompt: str`
- `conversation_history: list = Field(default_factory=list)`

This `default_factory` detail matters:
- it avoids mutable default-list issues at the Pydantic model level
- it ensures each request gets its own fresh history container

### `POST /get_response` (`backend/main.py`)
The endpoint now passes three inputs into `user_response_stream(...)`:
- retrieved formatted paper data
- the final user prompt
- the recent conversation history

This means any future changes to `user_response_stream(...)` must preserve compatibility with that three-argument call unless the frontend and endpoint are updated together.

## Updated AI Logic in `extractor.py`
The `user_response_stream(...)` function now accepts:
- `data: list`
- `user_prompt: str`
- `conversation_history: list | None = None`

### Message Construction Strategy
The OpenAI request is assembled in this order:

1. A single system message containing the tutoring instructions and RAG context.
2. Zero or more prior conversational turns pulled from `conversation_history`.
3. The latest user message appended at the end.

### History Sanitization
The backend currently performs lightweight filtering before forwarding history to OpenAI:
- only dictionary items are accepted
- only `role` values of `user` or `assistant` are allowed
- only string `content` values are allowed
- blank content is ignored

This reduces the chance of malformed frontend payloads corrupting the model input.

### Prompting Update
The tutoring system prompt now explicitly tells the model:
- to use prior conversation history when available
- to maintain continuity with earlier student questions and prior explanations

This was added because simply passing history is sometimes not enough; the model benefits from explicit instruction that the prior transcript is intentional and usable context.

## Updated Frontend Chat Flow in `ChatSection.jsx`
The frontend logic now includes additional conversation-history preparation before the existing two-step API flow.

### Relevant State
The following state variables are especially important to the updated logic:
- `messages`
- `paperData`
- `isLoading`
- metadata dropdown state (`subject`, `year`, `session`, `variant`, `questionNum`)

### New Helper Logic
There is now a helper:
- `formatConversationHistory(conversationHistory)`

Its job is to convert the structured recent message array into readable plain text lines such as:
- `User: ...`
- `Assistant: ...`

This helper is used for the frontend fallback strategy described below.

### Request Construction on Submit
When the user submits a message, the frontend performs the following sequence:

1. Reads the current prompt from local state.
2. Slices the last 10 entries from `messages`.
3. Maps them into `{ role, content }` objects using:
   - `user` for user bubbles
   - `assistant` for chatbot bubbles
4. Builds `formattedConversationHistory` for fallback prompt injection.
5. Builds a metadata-aware `backendPrompt`.
6. Builds a conversation-aware `responsePrompt`.

### Important Distinction Between `backendPrompt` and `responsePrompt`
These two prompts serve different purposes:

- `backendPrompt`
  - used for `/get_info`
  - includes metadata context for retrieval
  - supports question paper / mark scheme lookup

- `responsePrompt`
  - used for `/get_response`
  - includes recent conversation transcript when available
  - supports conversational continuity in the tutoring response

This distinction is intentional and should be preserved unless the API architecture is redesigned.

## Frontend Fallback Strategy for Deployment Mismatch
One subtle issue emerged during implementation:

- the frontend calls the deployed Railway backend directly
- the frontend and backend may not always be deployed at the same time
- a newer frontend may send `conversation_history` to an older backend that ignores it

To reduce this risk, the frontend now uses a **fallback strategy**:

- it still sends `conversation_history` as a structured field
- but it also embeds the same recent transcript directly into `responsePrompt`

The prompt is framed as a continuing chat session:
- it tells the model that the chat is ongoing
- it provides the previous messages as accessible context
- it appends the latest user message afterward

This means session memory can still function reasonably well even if the live backend deployment is lagging behind the frontend deployment.

## Why the First Attempt Appeared Not to Work
An observed failure mode during development was:
- the UI successfully showed prior chat bubbles
- the frontend sent the new field
- but the assistant still replied with language like "I can't access previous messages"

The most likely reason was deployment mismatch:
- the local code had been updated
- but the live backend at Railway may still have been running the old contract

This is a key operational detail for anyone debugging future memory issues.

## Updated Notes on `/get_info`
Another small but important refinement was made to the `/get_info` request:

- the frontend previously computed a `backendPrompt` string but did not actually send it
- it now sends `backendPrompt` as `user_prompt` to `/get_info`

This aligns retrieval behavior more closely with the currently selected metadata and the user's latest question.

## Ephemeral Nature of Memory
The new memory system is intentionally **not**:
- stored in Supabase
- stored in localStorage
- stored in sessionStorage
- tied to a user account
- recoverable across page refreshes

This design keeps implementation simple while the authentication and persistence layers do not yet exist.

## Additional Context: Authentication UI Placeholder
The app now has a **presentation-only auth surface**, but it still remains functionally unauthenticated.

### Current Product Behavior
- Users land on the normal chatbot interface by default.
- Unauthenticated users can open:
  - `Sign Up`
  - `Log In`
- Both flows are currently **UI only**:
  - no Supabase auth calls
  - no backend auth API
  - no session token storage
  - no account creation
  - no chat-history retrieval

### Current State Boundaries
- Auth form values live only in local component state inside `SignUpForm.jsx` and `LoginForm.jsx`.
- Closing the auth modal discards any entered values because there is no persistence layer yet.
- The auth overlay does not alter chatbot permissions or behavior; it is strictly a visual and structural placeholder.

### Why This Matters
This auth UI was intentionally introduced before the real auth backend so that:
- the visual experience can be refined independently
- `ChatSection.jsx` can remain mostly stable
- future Supabase auth and per-user history can be connected into already-isolated components rather than mixed into chat rendering logic

### Future Integration Direction
When real authentication is implemented, likely extension points include:
- replacing the no-op submit handlers in `SignUpForm.jsx` and `LoginForm.jsx`
- wiring the Google button to a real provider flow
- persisting grade/profile data to Supabase
- associating saved chats with authenticated user IDs
- replacing the unauthenticated top-right actions with authenticated account/history controls

## Risks and Future Extension Points
If future work expands the conversation system, the following areas are the most relevant:

### 1. Persisted History
Potential future options include:
- `localStorage` or `sessionStorage` for browser-only persistence
- a backend chat table for authenticated users
- per-user or per-thread chat records in Supabase

### 2. Token Growth
Even with only 10 messages, prompt size grows over time when responses are long. If the assistant becomes more verbose later, consider:
- trimming by token count instead of message count
- summarizing older turns
- preserving only user intents plus short assistant summaries

### 3. Prompt Reliability
The current fallback relies partly on prompt wording. If reliability becomes critical, possible upgrades include:
- stronger system-level instructions about transcript trust
- explicit assistant behavior rules for memory questions
- structured conversation objects with more validation

### 4. API Consistency
The current architecture depends on frontend and backend coordination in more than one way:
- request schema shape
- prompt construction
- history formatting assumptions

Anyone changing one side should inspect the other side immediately.

### 5. Auth / History Coupling
Once authentication is added, conversation history, user profiles, and authorization will likely become coupled. Future changes should keep clear boundaries between:
- auth/session state
- chat rendering state
- persisted history retrieval
- per-user Supabase writes

## Recommended Debugging Checklist for Future Agents
If conversation memory appears broken again, inspect these items in order:

1. Confirm the frontend `messages` state is actually accumulating prior turns.
2. Confirm the frontend is slicing the last 10 messages correctly.
3. Confirm the `/get_response` request body contains `conversation_history`.
4. Confirm the `user_prompt` sent to `/get_response` includes the fallback transcript text when prior messages exist.
5. Confirm the deployed backend version includes the updated `PromptResponse` schema.
6. Confirm `backend/main.py` still passes `conversation_history` into `user_response_stream(...)`.
7. Confirm `backend/extractor.py` still extends `chat_messages` with prior history before appending the latest user message.
8. Confirm the model prompt has not been changed in a way that encourages it to deny access to provided prior context.

## Documentation Note
This file now reflects the current baseline after both:
- the session-memory enhancement
- the UI-only authentication overlay addition

Future maintainers should treat this document as the active architectural snapshot rather than relying on the older README summary alone.

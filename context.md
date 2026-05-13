# Shamo AI Tutor - Technical Context & Implementation Details

This document contains a comprehensive breakdown of the technical implementations, design patterns, and file structures of the Shamo AI codebase. It is designed to preserve context for future development and AI agent migration.

## Directory Structure
```
Shamo/
├── backend/
│   ├── main.py                 # FastAPI application entry point
│   ├── extractor.py            # OpenAI GPT-4o logic and system prompts
│   ├── supabase_database.py    # Supabase client and querying logic
│   ├── classes.py              # Pydantic data models
│   ├── requirements.txt        # Python dependencies
│   └── .env                    # Environment variables (OpenAI, Supabase)
├── frontend/
│   ├── src/
│   │   ├── ChatSection/        # Main chat interface and logic
│   │   │   ├── ChatSection.jsx
│   │   │   └── ChatSection.module.css
│   │   ├── Sidebar/            # Sidebar navigation
│   │   │   ├── Sidebar.jsx
│   │   │   └── Sidebar.module.css
│   │   ├── utils/
│   │   │   └── variantRules.js # Logic for paper variants
│   │   ├── App.jsx             # Root component
│   │   ├── main.jsx            # React DOM rendering
│   │   └── index.css           # Global styles
│   ├── package.json            # Node dependencies
│   └── vite.config.js          # Vite configuration
├── README.md                   # Product overview
├── gemini.md                   # Task list & UI/UX Refinement notes
└── loading.md                  # Task list for loading animations
```

## Backend Implementation (`/backend`)
The backend is built with **FastAPI** and is currently deployed on Railway (`https://shamo-production.up.railway.app`).

### 1. API Endpoints (`main.py`)
- `POST /get_info`: 
  - **Input**: `PromptRequest` (user_prompt: str, metadata: list).
  - **Process**: Takes the metadata list (Subject, Year, Session, Variant, Question), formats it via `extractor.information_extraction`. Then uses `supabase_database.retrieve_info` to fetch the specific Question Paper (QP) and Mark Scheme (MS) content from Supabase.
  - **Output**: Returns the raw text of the QP and MS, and the extracted info.
- `POST /get_response`:
  - **Input**: `PromptResponse` (data_formatted: list, user_prompt: str).
  - **Process**: Takes the retrieved QP and MS text and the user's prompt. Calls `extractor.user_response_stream` to generate a response via OpenAI GPT-4o.
  - **Output**: Streams the response back to the client using FastAPI's `StreamingResponse` (`text/plain`).

### 2. AI Logic (`extractor.py`)
- **Model**: Uses `gpt-4o`.
- **`information_extraction(metadata)`**: Converts the frontend string metadata array into a structured dictionary with appropriate type casting (e.g., Year as `int`).
- **`user_response_stream(data, user_prompt)`**: The core AI tutor logic. The system prompt enforces strict rules:
  - Act as an expert Mathematics tutor.
  - Use the provided Question (LaTeX) and Mark Scheme.
  - Select only relevant information.
  - **CRITICAL**: Do not just solve the question. Refer to the Mark Scheme, analyze it, and explain steps.
  - Format with single `$` for inline math and double `$$` for block math.

### 3. Database (`supabase_database.py`)
- Uses the `supabase` Python client.
- Dynamically selects the table based on the subject (`"documents"` for IGCSE, `"A_level Math"` for A-level).
- Queries the table using a `.contains("metadata", search_criteria)` filter to match the exact paper and question.

## Frontend Implementation (`/frontend`)
The frontend is a **React + Vite** application.

### 1. Chat Interface (`ChatSection.jsx`)
This is the most complex component, handling state, metadata selection, and API communication.
- **State Management**: Uses `useState` for input values, selected metadata (Subject, Year, Session, Variant, Question), chat messages array, loading state, and cached paper data.
- **Metadata Logic**: Uses `utils/variantRules.js` to dynamically render valid paper variants based on the selected Subject and Session (e.g., Feb/March has fewer variants).
- **Two-Step API Process**:
  1. Calls `/get_info` with the prompt and metadata to retrieve the past paper context. If the query yields no new data, it falls back to the previously cached `paperData`.
  2. Calls `/get_response` with the retrieved context and streams the output.
- **Streaming Rendering**: Uses a `TextDecoder` to read chunks from the `ReadableStream` returned by the backend. Updates the `messages` state iteratively.
- **Auto-Scrolling**: Uses `requestAnimationFrame` and a `dummyRef` to ensure the chat window scrolls smoothly to the bottom as new chunks of text arrive, preventing jitter.
- **Markdown & Math**: Uses `react-markdown` with `remark-math` and `rehype-katex` to render the AI's response, properly formatting LaTeX equations and markdown structures.

### 2. Styling
- Uses CSS Modules (`ChatSection.module.css`, `Sidebar.module.css`) for component-scoped styling.
- Global variables and base typography are defined in `index.css`.
- The design aims for a modern, "SaaS" aesthetic with a dark theme (`#121212`, `#212121`).

## Recent Refinements (Context for ongoing work)
Based on `gemini.md` and `loading.md`, the following refinements have recently been implemented or are ongoing:
1. **Streaming Scroll Jitter**: Fixed using `requestAnimationFrame` targeting the container's `scrollHeight`.
2. **Metadata Dropdowns**: Added explicit dropdowns for Year, Session, Variant, and Question to reduce user prompt complexity.
3. **Cosmetic Overhaul**: Enhancing chat bubbles, fonts (e.g., Inter/Outfit), and sidebar UI.
4. **Loading Animations**: Implemented an `isLoading` state to show a spinner between the user's submission and the start of the AI's streaming response.

## Migration & Future Development Rules
- **Backend constraints**: Do not alter FastAPI endpoints or signatures without simultaneously updating the frontend fetch calls. The two-step call is necessary for the RAG architecture.
- **Prompt Engineering**: Be extremely careful when modifying the `user_response_stream` system prompt in `extractor.py`. The model must maintain its "tutor" persona and not devolve into an "answer bot."
- **Math Rendering**: The frontend expects single `$` and double `$$` for LaTeX. Ensure any new models or prompts adhere to this formatting for `rehype-katex` to work.

## Additional Context: Session Memory Implementation
The chat interface now includes **session-scoped conversational memory**. This was added after the initial implementation documented above and should be treated as part of the current baseline architecture.

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
- This is intended to represent approximately **5 full user/assistant back-and-forth exchanges**.
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
- It avoids mutable default-list issues at the Pydantic model level.
- It ensures each request gets its own fresh history container.

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
The OpenAI request is now assembled in this order:

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
The frontend `ChatSection.jsx` logic now includes additional conversation-history preparation before the existing two-step API flow.

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
When the user submits a message, the frontend now performs the following sequence:

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
  - Used for `/get_info`
  - Includes metadata context for retrieval
  - Supports question paper / mark scheme lookup

- `responsePrompt`
  - Used for `/get_response`
  - Includes recent conversation transcript when available
  - Supports conversational continuity in the tutoring response

This distinction is intentional and should be preserved unless the API architecture is redesigned.

## Frontend Fallback Strategy for Deployment Mismatch
One subtle issue emerged during implementation:

- the frontend calls the deployed Railway backend directly
- the frontend and backend may not always be deployed at the same time
- a newer frontend may send `conversation_history` to an older backend that ignores it

To reduce this risk, the frontend now uses a **fallback strategy**:

- it still sends `conversation_history` as a structured field
- but it also embeds the same recent transcript directly into `responsePrompt`

The prompt is framed as a continuing chat session, for example:
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

This is a key operational detail for anyone debugging future "memory is broken" reports.

## Updated Notes on `/get_info`
Another small but important refinement was made to the `/get_info` request:

- the frontend previously computed a `backendPrompt` string but did not actually send it
- it now sends `backendPrompt` as `user_prompt` to `/get_info`

This aligns retrieval behavior more closely with the currently selected metadata and the user’s latest question.

## Ephemeral Nature of Memory
The new memory system is intentionally **not**:
- stored in Supabase
- stored in localStorage
- stored in sessionStorage
- tied to a user account
- recoverable across page refreshes

This design keeps implementation simple while the authentication and persistence layers do not yet exist.

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
The current architecture now depends on frontend and backend coordination in more than one way:
- request schema shape
- prompt construction
- history formatting assumptions

Anyone changing one side should inspect the other side immediately.

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
The earlier sections of this file describe the original architecture accurately, but this appended section reflects the newer baseline after the session-memory enhancement. Future maintainers should read both together rather than treating the first half as the complete current state.

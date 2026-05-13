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

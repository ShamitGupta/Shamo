# Shamo AI Tutor

## Product Overview & Business Idea
Shamo AI is an AI-powered Mathematics tutor specifically designed to help students master IGCSE Additional Mathematics and A-level Mathematics past papers. 
The core business proposition is to act as an expert tutor rather than a simple answer-generator. When a student struggles with a specific question from a past paper, they can provide the metadata (Year, Session, Variant, Question Number) and ask for help. Shamo retrieves the exact question paper and mark scheme from a database and uses GPT-4o to analyze the student's problem, providing step-by-step explanations, referencing the mark scheme, and guiding the student to the answer conceptually.

## High-Level Architecture
Shamo follows a client-server architecture with an external database and AI API integration:

1. **Frontend (React + Vite)**: A modern, responsive chat interface where students can input their questions and select the past paper metadata via dropdowns. It supports rich text rendering, including LaTeX for mathematical formulas.
2. **Backend (FastAPI)**: A lightweight Python backend that orchestrates the flow of data. It handles CORS, input validation, and serves two main purposes: extracting structured metadata from the query and streaming the AI's response.
3. **Database (Supabase)**: Stores the text representations of past paper questions and mark schemes. The backend queries Supabase based on the user's selected metadata to retrieve the exact context needed.
4. **AI Engine (OpenAI GPT-4o)**: Powers the extraction of metadata and the generation of the tutoring response.

## Why this Architecture?
- **Separation of Concerns**: The frontend solely handles user experience and UI, while the backend orchestrates API keys, database calls, and prompt engineering.
- **Streaming Support**: Mathematical explanations can be long. Streaming the response from the OpenAI API through the FastAPI backend to the React frontend ensures a fast, responsive user experience without long wait times.
- **Accuracy**: By injecting the exact Mark Scheme and Question Paper text directly into the GPT-4o prompt (RAG - Retrieval-Augmented Generation), hallucinations are minimized, and the AI acts strictly based on the official curriculum.

## For AI Agents / Developers
If you are taking over this codebase, please refer to `context.md` for a deep dive into the technical implementation, file structures, state management, and specific logic constraints.

## Recent Product and Architecture Updates
The application has recently been extended with **ephemeral chat-session memory**. This memory is intentionally **not persisted in any database or browser storage** and exists only for the lifetime of the current React session in memory. As a result:

- The chatbot can now remember the most recent **10 messages** in the current session, which corresponds to roughly **5 complete user-assistant exchanges**.
- This memory is lost when the user refreshes the page, closes the tab, or otherwise remounts the frontend application.
- This behavior is deliberate because there is currently **no user authentication**, no chat history storage layer, and no requirement for cross-session continuity.

## Session Memory Design
The session-memory implementation was designed to be lightweight and compatible with the existing two-step RAG flow.

### Frontend Behavior
- The frontend maintains the full visible chat transcript in React state via the `messages` array in `frontend/src/ChatSection/ChatSection.jsx`.
- On every submit, the frontend slices the last 10 messages from this local array and converts them into a compact `conversationHistory` payload using OpenAI-style roles:
  - `user`
  - `assistant`
- That recent transcript is then attached to the `/get_response` request as `conversation_history`.

### Backend Behavior
- The backend `PromptResponse` schema now accepts a `conversation_history` field in addition to `data_formatted` and `user_prompt`.
- The backend `user_response_stream(...)` function appends those prior turns into the OpenAI `messages` array before adding the latest user message.
- The tutoring system prompt has also been updated to explicitly tell the model to use prior conversation history for continuity when it is available.

## Frontend Fallback for Older Deployments
Because the frontend currently calls the deployed Railway backend directly at:

- `https://shamo-production.up.railway.app/get_info`
- `https://shamo-production.up.railway.app/get_response`

there is an important deployment nuance:

- If the **frontend is newer than the deployed backend**, the live backend may ignore the new `conversation_history` field.
- To make the memory feature more resilient, the frontend now also includes a **fallback prompt strategy**:
  - It formats the recent chat transcript into plain text.
  - It injects that transcript directly into the `user_prompt` sent to `/get_response`.
  - This allows the model to retain conversational continuity even if the live backend has not yet been updated to read `conversation_history`.

This fallback is especially useful during staggered deployments where frontend and backend releases may not go live at exactly the same time.

## Prompt Construction Notes
There are now two related prompt-construction paths in the chat flow:

1. **Metadata/RAG prompt for `/get_info`**
   - The frontend builds a `backendPrompt` from dropdown metadata plus the current user message.
   - This supports better paper lookup and keeps metadata-aware retrieval aligned with the current chat request.

2. **Conversation-aware prompt for `/get_response`**
   - The frontend builds a `responsePrompt`.
   - If prior messages exist, it includes a labeled chat transcript plus the latest user message.
   - If no prior messages exist, it falls back to the raw current prompt.

This split preserves the existing retrieval architecture while improving conversational continuity in the final tutoring response.

## Current Limitations
- Session memory is **short-term only** and scoped to the current page lifetime.
- The app still does **not** support:
  - account-based memory
  - saved conversations
  - cross-device continuity
  - restoration after refresh
- Since the app still relies on the visible `messages` state for memory, any future UI changes that alter how messages are represented must be coordinated with the conversation-history formatting logic.

## Deployment Reminder
To fully activate the new conversational memory behavior in production:

- deploy the **frontend** so the recent message history is collected and sent
- deploy the **backend** so the `conversation_history` field is accepted and passed through to OpenAI

If only the frontend is deployed, the fallback prompt injection should still help.
If only the backend is deployed, the feature will not work because the frontend is responsible for collecting and sending the recent chat transcript.
